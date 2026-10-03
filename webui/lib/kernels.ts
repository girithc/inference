export interface KernelEntry {
  title: string;
  code: string;
}

export const kernels: Record<string, KernelEntry> = {
  "qwen3-8-27b": {
    title: "Qwen3 RMSNorm kernel",
    code: `import triton
import triton.language as tl

@triton.jit
def qwen3_rmsnorm_kernel(
    x_ptr,
    weight_ptr,
    output_ptr,
    stride_x,
    stride_weight,
    hidden_size,
    eps,
    BLOCK_SIZE: tl.constexpr,
):
    row = tl.program_id(0)
    col_offsets = tl.arange(0, BLOCK_SIZE)
    mask = col_offsets < hidden_size

    x = tl.load(
        x_ptr + row * stride_x + col_offsets,
        mask=mask,
        other=0.0,
    ).to(tl.float32)

    variance = tl.sum(x * x, axis=0) / hidden_size
    normalized = x * tl.rsqrt(variance + eps)

    weight = tl.load(
        weight_ptr + col_offsets,
        mask=mask,
        other=1.0,
    ).to(tl.float32)

    output = normalized * weight
    tl.store(
        output_ptr + row * stride_x + col_offsets,
        output.to(tl.float16),
        mask=mask,
    )
`,
  },
  "qwen-image-2-1": {
    title: "Qwen Image 3x3 convolution kernel",
    code: `import triton
import triton.language as tl

@triton.jit
def qwen_image_conv2d_kernel(
    input_ptr,
    weight_ptr,
    output_ptr,
    batch,
    in_channels,
    out_channels,
    height,
    width,
    kernel_size,
    stride_h,
    stride_w,
    BLOCK_N: tl.constexpr,
    BLOCK_K: tl.constexpr,
):
    pid_n = tl.program_id(0)
    pid_h = tl.program_id(1)
    pid_w = tl.program_id(2)

    n = pid_n
    h = pid_h * stride_h
    w = pid_w * stride_w

    acc = tl.zeros((BLOCK_N,), dtype=tl.float32)

    for c in range(in_channels):
        for kh in range(kernel_size):
            for kw in range(kernel_size):
                ih = h + kh
                iw = w + kw
                if ih < height and iw < width:
                    x = tl.load(
                        input_ptr
                        + n * in_channels * height * width
                        + c * height * width
                        + ih * width
                        + iw
                    ).to(tl.float32)

                    for oc in range(BLOCK_N):
                        weight = tl.load(
                            weight_ptr
                            + (oc * in_channels + c) * kernel_size * kernel_size
                            + kh * kernel_size
                            + kw
                        ).to(tl.float32)

                        acc += x * weight

    for oc in range(BLOCK_N):
        tl.store(
            output_ptr
            + n * out_channels * height * width
            + oc * height * width
            + h * width
            + w,
            acc[oc],
        )
`,
  },
  "yue2-3b": {
    title: "YuE2 GELU activation kernel",
    code: `import triton
import triton.language as tl

@triton.jit
def yue2_gelu_kernel(
    x_ptr,
    output_ptr,
    n_elements,
    BLOCK_SIZE: tl.constexpr,
):
    pid = tl.program_id(0)
    offsets = pid * BLOCK_SIZE + tl.arange(0, BLOCK_SIZE)
    mask = offsets < n_elements

    x = tl.load(x_ptr + offsets, mask=mask, other=0.0).to(tl.float32)
    cdf = 0.5 * (1.0 + tl.erf(x / tl.sqrt(2.0)))
    y = x * cdf

    tl.store(output_ptr + offsets, y.to(tl.float16), mask=mask)
`,
  },
  "minimax-h3-singularity": {
    title: "Minimax temporal pooling kernel",
    code: `import triton
import triton.language as tl

@triton.jit
def minimax_temporal_pool_kernel(
    input_ptr,
    output_ptr,
    batch,
    channels,
    depth,
    height,
    width,
    kernel_size,
    stride,
    BLOCK_C: tl.constexpr,
):
    pid_b = tl.program_id(0)
    pid_d = tl.program_id(1)
    pid_c = tl.program_id(2)

    acc = tl.zeros((BLOCK_C,), dtype=tl.float32)

    for kd in range(kernel_size):
        d = pid_d * stride + kd
        if d < depth:
            for c in range(channels):
                value = tl.load(
                    input_ptr
                    + pid_b * channels * depth * height * width
                    + c * depth * height * width
                    + d * height * width
                ).to(tl.float32)
                acc += value

    for c in range(BLOCK_C):
        tl.store(
            output_ptr
            + pid_b * channels * depth * height * width
            + c * depth * height * width
            + pid_d * stride * height * width,
            acc[c] / kernel_size,
        )
`,
  },
  "glm-ocr": {
    title: "GLM OCR softmax kernel",
    code: `import triton
import triton.language as tl

@triton.jit
def glm_ocr_softmax_kernel(
    input_ptr,
    output_ptr,
    n_rows,
    n_cols,
    BLOCK_SIZE: tl.constexpr,
):
    row = tl.program_id(0)
    col_offsets = tl.arange(0, BLOCK_SIZE)
    mask = col_offsets < n_cols

    x = tl.load(
        input_ptr + row * n_cols + col_offsets,
        mask=mask,
        other=float("-inf"),
    ).to(tl.float32)

    max_x = tl.max(x, axis=0)
    exp_x = tl.exp(x - max_x)
    sum_exp = tl.sum(exp_x, axis=0)
    y = exp_x / sum_exp

    tl.store(
        output_ptr + row * n_cols + col_offsets,
        y.to(tl.float16),
        mask=mask,
    )
`,
  },
  "deepseek-ocr": {
    title: "DeepSeek OCR LayerNorm kernel",
    code: `import triton
import triton.language as tl

@triton.jit
def deepseek_ocr_layernorm_kernel(
    input_ptr,
    gamma_ptr,
    beta_ptr,
    output_ptr,
    n_cols,
    eps,
    BLOCK_SIZE: tl.constexpr,
):
    row = tl.program_id(0)
    col_offsets = tl.arange(0, BLOCK_SIZE)
    mask = col_offsets < n_cols

    x = tl.load(
        input_ptr + row * n_cols + col_offsets,
        mask=mask,
        other=0.0,
    ).to(tl.float32)

    mean = tl.sum(x, axis=0) / n_cols
    variance = tl.sum((x - mean) * (x - mean), axis=0) / n_cols
    normalized = (x - mean) * tl.rsqrt(variance + eps)

    gamma = tl.load(gamma_ptr + col_offsets, mask=mask, other=1.0).to(tl.float32)
    beta = tl.load(beta_ptr + col_offsets, mask=mask, other=0.0).to(tl.float32)

    y = normalized * gamma + beta
    tl.store(
        output_ptr + row * n_cols + col_offsets,
        y.to(tl.float16),
        mask=mask,
    )
`,
  },
};
