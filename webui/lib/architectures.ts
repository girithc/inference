export interface ArchitectureEntry {
  title: string;
  code: string;
}

export const architectures: Record<string, ArchitectureEntry> = {
  "qwen3-8-27b": {
    title: "Qwen3.8 27B architecture",
    code: `import torch
from torch import nn

class Qwen3Attention(nn.Module):
    def __init__(self, dim, heads, head_dim):
        super().__init__()
        self.heads = heads
        self.head_dim = head_dim
        self.q_proj = nn.Linear(dim, heads * head_dim, bias=False)
        self.k_proj = nn.Linear(dim, heads * head_dim, bias=False)
        self.v_proj = nn.Linear(dim, heads * head_dim, bias=False)
        self.out_proj = nn.Linear(heads * head_dim, dim, bias=False)

    def forward(self, x, rotary):
        bsz, seqlen, dim = x.shape
        q = self.q_proj(x).view(bsz, seqlen, self.heads, self.head_dim)
        k = self.k_proj(x).view(bsz, seqlen, self.heads, self.head_dim)
        v = self.v_proj(x).view(bsz, seqlen, self.heads, self.head_dim)

        q, k = rotary(q, k)
        attn = torch.nn.functional.scaled_dot_product_attention(
            q.transpose(1, 2),
            k.transpose(1, 2),
            v.transpose(1, 2),
        )

        return self.out_proj(attn.transpose(1, 2).reshape(bsz, seqlen, -1))


class Qwen3FeedForward(nn.Module):
    def __init__(self, dim, hidden_dim):
        super().__init__()
        self.gate_proj = nn.Linear(dim, hidden_dim, bias=False)
        self.up_proj = nn.Linear(dim, hidden_dim, bias=False)
        self.down_proj = nn.Linear(hidden_dim, dim, bias=False)

    def forward(self, x):
        return self.down_proj(
            nn.functional.silu(self.gate_proj(x)) * self.up_proj(x)
        )
`,
  },
  "qwen-image-2-1": {
    title: "Qwen Image 2.1 architecture",
    code: `import torch
from torch import nn

class QwenImagePatchEmbed(nn.Module):
    def __init__(self, in_channels=3, dim=1280, patch_size=2):
        super().__init__()
        self.proj = nn.Conv2d(
            in_channels,
            dim,
            kernel_size=patch_size,
            stride=patch_size,
        )

    def forward(self, x):
        x = self.proj(x)
        return x.flatten(2).transpose(1, 2)


class QwenImageTransformerBlock(nn.Module):
    def __init__(self, dim, heads, mlp_ratio=4):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(dim, heads, batch_first=True)
        self.norm2 = nn.LayerNorm(dim)
        hidden = dim * mlp_ratio
        self.mlp = nn.Sequential(
            nn.Linear(dim, hidden),
            nn.GELU(),
            nn.Linear(hidden, dim),
        )

    def forward(self, x, context):
        residual = x
        x = self.norm1(x)
        x, _ = self.attn(x, context, context, need_weights=False)
        x = residual + x

        residual = x
        x = self.norm2(x)
        return residual + self.mlp(x)
`,
  },
  "yue2-3b": {
    title: "YuE2 3B architecture",
    code: `import torch
from torch import nn

class YuE2MusicTransformer(nn.Module):
    def __init__(self, vocab_size, dim=3072, depth=28, heads=24):
        super().__init__()
        self.token_emb = nn.Embedding(vocab_size, dim)
        self.pos_emb = nn.Parameter(torch.zeros(1, 4096, dim))
        self.blocks = nn.ModuleList([
            nn.TransformerEncoderLayer(
                d_model=dim,
                nhead=heads,
                dim_feedforward=dim * 4,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            for _ in range(depth)
        ])
        self.norm = nn.LayerNorm(dim)
        self.head = nn.Linear(dim, vocab_size, bias=False)

    def forward(self, tokens):
        x = self.token_emb(tokens) + self.pos_emb[:, : tokens.size(1)]
        for block in self.blocks:
            x = block(x)
        return self.head(self.norm(x))
`,
  },
  "minimax-h3-singularity": {
    title: "Minimax H3 Singularity architecture",
    code: `import torch
from torch import nn

class MinimaxVideoPatchEmbed(nn.Module):
    def __init__(self, in_channels=3, dim=1536, patch_size=2):
        super().__init__()
        self.proj = nn.Conv3d(
            in_channels,
            dim,
            kernel_size=patch_size,
            stride=patch_size,
        )

    def forward(self, video):
        x = self.proj(video)
        return x.flatten(2).transpose(1, 2)


class MinimaxTemporalAttention(nn.Module):
    def __init__(self, dim, heads):
        super().__init__()
        self.norm = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(dim, heads, batch_first=True)

    def forward(self, x):
        residual = x
        x = self.norm(x)
        x, _ = self.attn(x, x, x, need_weights=False)
        return residual + x
`,
  },
  "glm-ocr": {
    title: "GLM OCR architecture",
    code: `import torch
from torch import nn

class GLMOCRVisionEncoder(nn.Module):
    def __init__(self, dim=1024, depth=24, heads=16):
        super().__init__()
        self.patch_embed = nn.Conv2d(3, dim, kernel_size=16, stride=16)
        self.blocks = nn.ModuleList([
            nn.TransformerEncoderLayer(
                d_model=dim,
                nhead=heads,
                dim_feedforward=dim * 4,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            for _ in range(depth)
        ])

    def forward(self, image):
        x = self.patch_embed(image)
        return self.blocks[0](x.flatten(2).transpose(1, 2))


class GLMOCRTextDecoder(nn.Module):
    def __init__(self, vocab_size, dim=1024):
        super().__init__()
        self.token_emb = nn.Embedding(vocab_size, dim)
        self.decoder = nn.TransformerDecoder(
            nn.TransformerDecoderLayer(
                d_model=dim,
                nhead=16,
                dim_feedforward=dim * 4,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            ),
            num_layers=6,
        )
        self.head = nn.Linear(dim, vocab_size, bias=False)

    def forward(self, image_tokens, text_tokens):
        memory = image_tokens
        x = self.token_emb(text_tokens)
        return self.head(self.decoder(x, memory))
`,
  },
  "deepseek-ocr": {
    title: "DeepSeek OCR architecture",
    code: `import torch
from torch import nn

class DeepSeekOCRVisionTower(nn.Module):
    def __init__(self, dim=1280, depth=32, heads=16):
        super().__init__()
        self.patch_embed = nn.Conv2d(3, dim, kernel_size=14, stride=14)
        self.blocks = nn.ModuleList([
            nn.TransformerEncoderLayer(
                d_model=dim,
                nhead=heads,
                dim_feedforward=dim * 4,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            for _ in range(depth)
        ])

    def forward(self, image):
        x = self.patch_embed(image)
        return x.flatten(2).transpose(1, 2)


class DeepSeekOCRDecoder(nn.Module):
    def __init__(self, vocab_size, dim=1280):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, dim)
        self.decoder = nn.TransformerDecoder(
            nn.TransformerDecoderLayer(
                d_model=dim,
                nhead=16,
                dim_feedforward=dim * 4,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            ),
            num_layers=8,
        )
        self.output = nn.Linear(dim, vocab_size, bias=False)

    def forward(self, vision_tokens, text_tokens):
        x = self.embedding(text_tokens)
        return self.output(self.decoder(x, vision_tokens))
`,
  },
};
