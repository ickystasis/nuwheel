import os
import tempfile
import unittest

from app import create_app


class StatsTests(unittest.TestCase):
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

    def test_stats_exclude_disabled_rows_and_count_participants(self):
        self.client.post('/api/watchers', json={'name': 'Alice', 'points': 3, 'color': '#ff0000'})
        self.client.post('/api/watchers', json={'name': 'Bob', 'points': 2, 'color': '#00ff00'})

        self.client.post('/api/winners', json={
            'title_name': 'Movie One',
            'watcher_name': 'Alice',
            'weight': 4,
            'total_weight': 10,
            'participants': 'Alice, Bob',
            'status': 'active'
        })
        self.client.post('/api/winners', json={
            'title_name': 'Movie Two',
            'watcher_name': 'Bob',
            'weight': 3,
            'total_weight': 8,
            'participants': 'Alice',
            'status': 'disabled'
        })

        response = self.client.get('/api/stats')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['total_active_sessions'], 1)
        self.assertEqual(payload['watchers'][0]['name'], 'Alice')
        self.assertEqual(payload['watchers'][0]['attendance_count'], 1)
        self.assertEqual(payload['watchers'][0]['pick_count'], 1)
        self.assertEqual(payload['watchers'][0]['punish_count'], 0)
        self.assertEqual(payload['watchers'][1]['name'], 'Bob')
        self.assertEqual(payload['watchers'][1]['attendance_count'], 1)
        self.assertEqual(payload['watchers'][1]['pick_count'], 0)


if __name__ == '__main__':
    unittest.main()
