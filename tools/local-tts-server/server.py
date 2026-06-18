"""
GIENIU Local TTS Server
Minimal HTTP server that exposes POST /tts returning audio/wav or audio/mpeg.

Configure the actual TTS engine below — default uses pyttsx3 (offline, free, unlimited).
For higher quality, swap in Kokoro, Piper, or any other local model.

Usage:
  pip install -r requirements.txt
  python server.py
"""
from __future__ import annotations

import io
import os
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('gieniu-tts')

PORT = int(os.getenv('PORT', '7501'))
API_KEY = os.getenv('GIENIU_LOCAL_TTS_KEY', '')  # optional — leave blank to allow all


def synthesize(text: str) -> bytes:
    """
    Synthesize text to audio bytes.
    Replace this function with your preferred TTS engine.

    Options:
      - pyttsx3  (offline, cross-platform, limited quality)  — pip install pyttsx3
      - kokoro   (high quality, English)                     — pip install kokoro soundfile
      - piper    (high quality, many languages)              — see piper-tts on GitHub
    """
    try:
        import pyttsx3
        engine = pyttsx3.init()
        buf = io.BytesIO()
        engine.save_to_file(text, '/tmp/gieniu_tts_out.wav')
        engine.runAndWait()
        with open('/tmp/gieniu_tts_out.wav', 'rb') as f:
            return f.read()
    except ImportError:
        raise RuntimeError(
            "No TTS engine available. "
            "Install pyttsx3: pip install pyttsx3, "
            "or swap synthesize() for Kokoro/Piper."
        )


class TTSHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info(fmt % args)

    def send_json(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_POST(self):
        if self.path != '/tts':
            self.send_json(404, {'error': 'Not found'})
            return

        if API_KEY:
            auth = self.headers.get('Authorization', '')
            if auth.replace('Bearer ', '').strip() != API_KEY:
                self.send_json(401, {'error': 'Unauthorized'})
                return

        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self.send_json(400, {'error': 'Invalid JSON body'})
            return

        text = (body.get('text') or '').strip()
        if not text:
            self.send_json(400, {'error': 'Missing text field'})
            return

        try:
            audio = synthesize(text)
        except Exception as e:
            logger.error('TTS synthesis error: %s', e)
            self.send_json(500, {'error': str(e)})
            return

        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('Content-Length', str(len(audio)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(audio)


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), TTSHandler)
    logger.info('GIENIU local TTS server listening on port %d', PORT)
    server.serve_forever()
