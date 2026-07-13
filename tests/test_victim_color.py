import os
import tempfile
import unittest

from app import create_app


class VictimColorTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        os.environ['DB_DIR'] = self.tmpdir.name
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def tearDown(self):
        from app.models import close_db
        with self.app.app_context():
            close_db(None)
        self.tmpdir.cleanup()

    def test_new_watcher_accepts_color_and_returns_it(self):
        response = self.client.post('/api/watchers', json={
            'name': 'Alice',
            'points': 5,
            'color': '#ff00aa'
        })
        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertEqual(payload['name'], 'Alice')
        self.assertEqual(payload['color'], '#ff00aa')

        data_response = self.client.get('/api/data')
        self.assertEqual(data_response.status_code, 200)
        data = data_response.get_json()
        self.assertEqual(data[0]['color'], '#ff00aa')


if __name__ == '__main__':
    unittest.main()
