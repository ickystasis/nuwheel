import io
import os
import tempfile
import unittest

from app import create_app


class UserMediaTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        os.environ['DB_DIR'] = self.tmpdir.name
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        resp = self.client.post('/api/watchers', json={
            'name': 'Alice',
            'points': 5,
            'color': '#ff00aa'
        })
        self.user_id = resp.get_json()['id']

    def tearDown(self):
        from app.models import close_db
        with self.app.app_context():
            close_db(None)
        self.tmpdir.cleanup()

    def _upload(self, media_type, filename, content):
        return self.client.post(
            '/api/user-media/upload',
            data={
                'user_id': str(self.user_id),
                'media_type': media_type,
                'file': (io.BytesIO(content), filename),
            },
            content_type='multipart/form-data',
        )

    def test_valid_mp3_upload(self):
        response = self._upload('song', 'tune.mp3', b'ID3\x04\x00\x00\x00\x00\x00\x00fake')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['ok'])

    def test_valid_wav_upload(self):
        content = b'RIFF' + b'\x00\x00\x00\x00' + b'WAVE' + b'fmt '
        response = self._upload('cheer', 'cheer.wav', content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['ok'])

    def test_valid_png_upload(self):
        content = b'\x89PNG\r\n\x1a\n' + b'fake'
        response = self._upload('graphic', 'pic.png', content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['ok'])

    def test_reject_executable_extension(self):
        response = self._upload('song', 'evil.exe', b'ID3\x04\x00\x00\x00fake')
        self.assertEqual(response.status_code, 400)

    def test_reject_wrong_magic_bytes(self):
        response = self._upload('song', 'fake.mp3', b'NOTANMP3FILE!!')
        self.assertEqual(response.status_code, 400)

    def test_reject_audio_in_graphic(self):
        response = self._upload('graphic', 'song.mp3', b'ID3\x04\x00\x00\x00fake')
        self.assertEqual(response.status_code, 400)

    def test_reject_invalid_media_type(self):
        response = self._upload('video', 'clip.mp3', b'ID3\x04\x00\x00\x00fake')
        self.assertEqual(response.status_code, 400)

    def test_reject_oversize_file(self):
        big = b'ID3' + b'\x00' * (50 * 1024 * 1024 + 1)
        response = self._upload('song', 'big.mp3', big)
        self.assertEqual(response.status_code, 400)

    def test_list_and_fetch_user_media(self):
        self._upload('song', 'tune.mp3', b'ID3\x04\x00\x00\x00fake')
        listing = self.client.get(f'/api/user-media/{self.user_id}/song')
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.get_json(), ['tune.mp3'])

        fetched = self.client.get(f'/api/user-media/{self.user_id}/song/tune.mp3')
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.data, b'ID3\x04\x00\x00\x00fake')

    def test_unknown_user_rejected(self):
        response = self._upload('song', 'tune.mp3', b'ID3\x04\x00\x00\x00fake')
        self.assertEqual(response.status_code, 200)
        response = self.client.post(
            '/api/user-media/upload',
            data={
                'user_id': '99999',
                'media_type': 'song',
                'file': (io.BytesIO(b'ID3\x04\x00\x00\x00fake'), 'tune.mp3'),
            },
            content_type='multipart/form-data',
        )
        self.assertEqual(response.status_code, 404)

    def test_last_spin_winner_seeded_from_history(self):
        from app.models import get_db
        with self.app.app_context():
            db = get_db(self.app)
            db.execute(
                "INSERT INTO winners (title_name, watcher_name, weight, total_weight) "
                "VALUES ('Movie', 'Alice', 1, 6)"
            )
            db.commit()
        resp = self.client.get('/api/settings')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['last_spin_winner_id'], self.user_id)

    def test_explicit_last_spin_winner_setting_wins_over_history(self):
        from app.models import get_db
        with self.app.app_context():
            db = get_db(self.app)
            db.execute(
                "INSERT INTO winners (title_name, watcher_name, weight, total_weight) "
                "VALUES ('Movie', 'Alice', 1, 6)"
            )
            db.commit()
        bob = self.client.post('/api/watchers', json={
            'name': 'Bob',
            'points': 5,
            'color': '#0000ff'
        }).get_json()['id']
        self.client.put('/api/settings', json={'last_spin_winner_id': bob})
        resp = self.client.get('/api/settings')
        self.assertEqual(resp.get_json()['last_spin_winner_id'], str(bob))


if __name__ == '__main__':
    unittest.main()
