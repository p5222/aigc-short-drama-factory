# LongCat-AudioDiT Cloud TTS Integration

LongCat-AudioDiT is kept as an optional role voiceover provider for Manjiao. It should run on a GPU cloud/server sidecar, not inside the local `E:\AI漫剧` workspace.

## Runtime Policy

- Default production path: `TTS_PROVIDER=longcat-audiodit` plus `LONGCAT_AUDIODIT_BASE_URL=https://your-gpu-tts-host`.
- Local Python bridge is disabled unless `LONGCAT_AUDIODIT_ALLOW_LOCAL_BRIDGE=true`.
- Do not download model weights, tokenizer weights, PyTorch caches, or virtualenvs into `E:\AI漫剧\tmp`.
- If a video model already generates native speech, treat LongCat as optional post voiceover/replacement, not the primary requirement.

## API Environment

```bash
TTS_PROVIDER=longcat-audiodit
LONGCAT_AUDIODIT_BASE_URL=http://longcat-audiodit:7868
LONGCAT_AUDIODIT_TTS_PATH=/tts
LONGCAT_AUDIODIT_MODEL=meituan-longcat/LongCat-AudioDiT-1B
LONGCAT_AUDIODIT_TOKENIZER_MODEL=/opt/models/umt5-base
LONGCAT_AUDIODIT_TIMEOUT_MS=900000
LONGCAT_AUDIODIT_GUIDANCE_METHOD=apg
LONGCAT_AUDIODIT_GUIDANCE_STRENGTH=4
LONGCAT_AUDIODIT_NFE=16
LONGCAT_AUDIODIT_DTYPE=auto
LONGCAT_AUDIODIT_ALLOW_LOCAL_BRIDGE=false
```

Role voices are mapped with reference audio and transcript:

```bash
LONGCAT_AUDIODIT_PROMPT_MAP={"旁白":{"promptAudio":"https://cdn.example.com/voices/narrator.wav","promptText":"这里填写旁白参考音频对应原文。"},"女主":{"promptAudio":"https://cdn.example.com/voices/heroine.wav","promptText":"这里填写女主参考音频对应原文。"}}
```

## GPU Sidecar Shape

Deploy the open-source LongCat project on a GPU host:

```bash
git clone https://github.com/meituan-longcat/LongCat-AudioDiT.git /opt/LongCat-AudioDiT
cd /opt/LongCat-AudioDiT
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install sentencepiece protobuf hf_xet
```

Start the Manjiao bridge as an HTTP sidecar:

```bash
python /opt/manjiao/tools/longcat-audiodit/longcat_tts_bridge.py \
  --serve \
  --host 0.0.0.0 \
  --port 7868 \
  --repo_dir /opt/LongCat-AudioDiT \
  --model_dir meituan-longcat/LongCat-AudioDiT-1B \
  --device cuda \
  --guidance_method apg
```

Health check:

```bash
curl http://127.0.0.1:7868/health
```

## Manjiao Flow

```mermaid
flowchart LR
  A["Storyboard dialogue / voiceOver"] --> B["buildVoiceCues"]
  B --> C["speaker + voice + duration"]
  C --> D["LONGCAT_AUDIODIT_PROMPT_MAP"]
  D --> E["Cloud GPU LongCat sidecar"]
  E --> F["WAV voiceover track"]
  F --> G["tts-manifest.json"]
  G --> H["Subtitle / MP4 export"]
```

## Frontend UX

- Script, storyboard, and shot workbenches store dialogue, speaker, tone, environment sound, and subtitle intent.
- The video loop workbench can generate TTS as an export task, but internal model paths and prompt internals are not shown in the UI.
- Voice preview/editing should work from generated audio URLs or export jobs, not from local model folders.

## Local Development Escape Hatch

Only use this when intentionally debugging the bridge on a machine with enough disk/GPU capacity:

```bash
TTS_PROVIDER=longcat-audiodit
LONGCAT_AUDIODIT_ALLOW_LOCAL_BRIDGE=true
LONGCAT_AUDIODIT_BASE_URL=
LONGCAT_AUDIODIT_REPO_DIR=/opt/LongCat-AudioDiT
LONGCAT_AUDIODIT_PYTHON=/opt/LongCat-AudioDiT/.venv/bin/python
LONGCAT_AUDIODIT_TOKENIZER_MODEL=/opt/models/umt5-base
LONGCAT_AUDIODIT_DEVICE=cuda
```

Keep this disabled on the Windows workstation unless the user explicitly chooses to allocate disk space for local model testing.
