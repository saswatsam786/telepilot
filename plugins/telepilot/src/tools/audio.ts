// Voice notes: Telegram sends OGG/Opus. Convert with ffmpeg and transcribe locally
// with whisper.cpp, so audio never leaves the Mac.

import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { loadConfig } from '../lib/config'
import { expandHome, HOME, run } from '../lib/util'
import { fail, obj, str, text, type Tool } from './types'

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'

export const audioTools: Tool[] = [
  {
    name: 'transcribe',
    description:
      'Transcribe an audio file (e.g. a Telegram voice note fetched with download_attachment) to text, locally with whisper.cpp.',
    inputSchema: obj({ path: str('absolute path to the audio file'), language: str('language code, default auto') }, ['path']),
    run: async a => {
      const ffmpeg = Bun.which('ffmpeg')
      const whisper = Bun.which('whisper-cli') ?? Bun.which('whisper-cpp')
      const model = expandHome(loadConfig().whisperModel ?? join(HOME(), 'models', 'ggml-base.bin'))
      if (!ffmpeg || !whisper || !existsSync(model)) {
        return fail(
          [
            'Voice transcription is not set up. On the Mac run:',
            '  brew install ffmpeg whisper-cpp',
            `  mkdir -p ~/.telepilot/models && curl -L -o ${model} ${MODEL_URL}`,
          ].join('\n'),
        )
      }
      const input = resolve(expandHome(String(a.path)))
      if (!existsSync(input)) return fail(`file not found: ${input}`)
      const dir = join(tmpdir(), `telepilot-voice-${process.pid}-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      try {
        const wav = join(dir, 'audio.wav')
        const conv = await run([ffmpeg, '-nostdin', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeoutMs: 60_000 })
        if (conv.code !== 0) return fail(`ffmpeg failed: ${conv.stderr.trim().split('\n').pop()}`)
        const r = await run([whisper, '-m', model, '-f', wav, '-nt', '-np', '-l', String(a.language ?? 'auto')], { timeoutMs: 180_000 })
        if (r.code !== 0) return fail(`whisper failed: ${r.stderr.trim().split('\n').pop()}`)
        return text(r.stdout.replace(/\s+/g, ' ').trim() || '(no speech detected)')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  },
]
