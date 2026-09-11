import unittest
from install_caddy_route import add_route


class CaddyRouteTest(unittest.TestCase):
    def test_preserves_other_sites_and_is_idempotent(self):
        other = '\napi.manjiao.cloud {\n\treverse_proxy 127.0.0.1:18080\n}\n'
        initial = 'manjiao.cloud, www.manjiao.cloud {\n\tencode gzip\n\treverse_proxy 127.0.0.1:8080\n}\n' + other
        updated = add_route(initial)
        self.assertTrue(updated.endswith(other))
        self.assertIn('path /ops /ops/*', updated)
        self.assertEqual(updated, add_route(updated))

    def test_refuses_unknown_config(self):
        for config in ['', 'example.com {\n}\n', 'manjiao.cloud, www.manjiao.cloud {\n handle / {\n}\n']:
            with self.assertRaises(ValueError):
                add_route(config)


if __name__ == '__main__':
    unittest.main()
