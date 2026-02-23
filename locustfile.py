from locust import HttpUser, task, between, events
import requests
import gevent

FASTAPI_STATS_URL = "http://127.0.0.1:8080/api/stats"

class ProxyUser(HttpUser):
    wait_time = between(0.1, 1.0)

    @task
    def proxy_request(self):
        self.client.get("/proxy/")

@events.init.add_listener
def on_locust_init(environment, **kwargs):
    def stats_sender():
        while True:
            gevent.sleep(1.0)
            if environment.runner is None:
                continue
            
            total = environment.runner.stats.total
            payload = {
                "total_rps": total.current_rps,
                "total_failures": total.current_fail_per_sec,
                "avg_response_time": total.avg_response_time,
                "user_count": environment.runner.user_count,
            }
            try:
                requests.post(FASTAPI_STATS_URL, json=payload, timeout=0.5)
            except Exception:
                pass # Ignore errors posting stats

    gevent.spawn(stats_sender)
