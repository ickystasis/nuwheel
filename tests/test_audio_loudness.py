import os
import shutil
import subprocess
import tempfile
import unittest

from app.audio_loudness import (
    AUDIO_EXTS,
    CHEER_LUFS,
    MUSIC_LUFS,
    NORM_PREFIX,
    TARGET_DIRS,
    ffmpeg_available,
    normalize_audio,
    normalized_filename,
    target_for_dirname,
)

FFMPEG = shutil.which('ffmpeg')


class AudioLoudnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_target_mapping(self):
        self.assertEqual(TARGET_DIRS['music'], MUSIC_LUFS)
        self.assertEqual(TARGET_DIRS['song'], MUSIC_LUFS)
        self.assertEqual(TARGET_DIRS['cheers'], CHEER_LUFS)
        self.assertEqual(TARGET_DIRS['cheer'], CHEER_LUFS)
        self.assertIsNone(target_for_dirname('graphic'))
        self.assertIsNone(target_for_dirname(''))

    def test_audio_exts(self):
        self.assertIn('.mp3', AUDIO_EXTS)
        self.assertIn('.wav', AUDIO_EXTS)

    @unittest.skipUnless(FFMPEG, 'ffmpeg not installed')
    def test_normalize_wav_produces_valid_output(self):
        src = os.path.join(self.dir, 'in.wav')
        self._make_sine(src)
        ok, msg = normalize_audio(src, target_lufs=CHEER_LUFS)
        self.assertTrue(ok, msg)
        out = os.path.join(self.dir, 'N_in.wav')
        self.assertTrue(os.path.exists(out))
        self.assertFalse(os.path.exists(src))
        with open(out, 'rb') as f:
            self.assertEqual(f.read(4), b'RIFF')

    @unittest.skipUnless(FFMPEG, 'ffmpeg not installed')
    def test_normalize_mp3_output(self):
        src = os.path.join(self.dir, 'in.mp3')
        self._make_sine(src)
        ok, msg = normalize_audio(src, target_lufs=MUSIC_LUFS)
        self.assertTrue(ok, msg)
        out = os.path.join(self.dir, 'N_in.mp3')
        self.assertTrue(os.path.exists(out))
        with open(out, 'rb') as f:
            self.assertEqual(f.read(3), b'ID3')

    @unittest.skipUnless(FFMPEG, 'ffmpeg not installed')
    def test_normalize_keeps_existing_prefix(self):
        src = os.path.join(self.dir, 'N_in.wav')
        self._make_sine(src)
        ok, msg = normalize_audio(src, target_lufs=CHEER_LUFS)
        self.assertTrue(ok, msg)
        self.assertTrue(os.path.exists(src))
        self.assertFalse(os.path.exists(os.path.join(self.dir, 'N_N_in.wav')))

    def test_normalized_filename_helper(self):
        self.assertEqual(normalized_filename('tune.mp3'), 'N_tune.mp3')
        self.assertEqual(normalized_filename('/x/y/tune.wav'), 'N_tune.wav')
        self.assertEqual(normalized_filename('N_tune.mp3'), 'N_tune.mp3')
        self.assertEqual(NORM_PREFIX, 'N_')

    def test_normalize_missing_file_fails_gracefully(self):
        ok, msg = normalize_audio(os.path.join(self.dir, 'nope.wav'))
        self.assertFalse(ok)
        self.assertIn('not found', msg)

    @unittest.skipUnless(FFMPEG, 'ffmpeg not installed')
    def test_garbage_audio_leaves_original_intact(self):
        src = os.path.join(self.dir, 'junk.wav')
        original = b'RIFF\x00\x00\x00\x00WAVEjunk'
        with open(src, 'wb') as f:
            f.write(original)
        ok, _ = normalize_audio(src, target_lufs=CHEER_LUFS)
        self.assertFalse(ok)
        with open(src, 'rb') as f:
            self.assertEqual(f.read(), original)

    def _make_sine(self, path):
        subprocess.run(
            [
                'ffmpeg', '-nostdin', '-y', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
                path,
            ],
            check=True,
        )


if __name__ == '__main__':
    unittest.main()