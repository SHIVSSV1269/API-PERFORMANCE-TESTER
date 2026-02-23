import asyncio
import os
import random
import subprocess
import json
from typing import Dict, Any, Optional

from fastapi import FastAPI, Request, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import httpx

app = FastAPI(title="Chaos Tester API")

# Ensure static and templates directories exist for mounting
os.makedirs("static", exist_ok=True)
os.makedirs("templates", exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Global state
class ChaosConfig(BaseModel):
    latency_ms: int = 0
    latency_jitter_ms: int = 0
    packet_loss_percent: float = 0.0
    rate_limit_percent: float = 0.0
    slowdown_multiplier: float = 1.0

class LoadConfig(BaseModel):
    target_url: str = "https://jsonplaceholder.typicode.com/todos/1"
    users: int = 10
    spawn_rate: int = 2

chaos_state = ChaosConfig()
load_state = LoadConfig()
locust_process: Optional[subprocess.Popen] = None
active_websockets = []

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/chaos")
async def update_chaos(config: ChaosConfig):
    global chaos_state
    chaos_state = config
    return {"status": "success", "chaos_state": chaos_state.dict()}

@app.post("/api/load/start")
async def start_load(config: LoadConfig):
    global load_state, locust_process
    if locust_process and locust_process.poll() is None:
        return {"status": "error", "message": "Load test already running"}
    
    load_state = config
    
    # Start locust as subprocess
    env = os.environ.copy()
    env["TARGET_URL"] = load_state.target_url
    
    cmd = [
        "python", "-m", "locust",
        "-f", "locustfile.py",
        "--headless",
        "-u", str(load_state.users),
        "-r", str(load_state.spawn_rate),
        "-H", "http://127.0.0.1:8080" # Hit our proxy
    ]
    
    locust_process = subprocess.Popen(cmd, env=env)
    return {"status": "success", "message": "Load test started"}

@app.post("/api/load/stop")
async def stop_load():
    global locust_process
    if locust_process and locust_process.poll() is None:
        locust_process.terminate()
        locust_process = None
        return {"status": "success", "message": "Load test stopped"}
    return {"status": "error", "message": "Load test not running"}

@app.post("/api/stats")
async def receive_stats(stats: Dict[Any, Any]):
    # Broadcast to websockets
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_json(stats)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        active_websockets.remove(ws)
    return {"status": "ok"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_websockets.remove(websocket)

# --- Chaos Proxy ---
client = httpx.AsyncClient()

@app.api_route("/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_route(path: str, request: Request):
    # Simulation: Packet Loss
    if chaos_state.packet_loss_percent > 0:
        if random.random() < (chaos_state.packet_loss_percent / 100.0):
            return HTMLResponse(content="Packet Loss Simulated (502 Bad Gateway)", status_code=502)
            
    # Simulation: Rate Limiting
    if chaos_state.rate_limit_percent > 0:
        if random.random() < (chaos_state.rate_limit_percent / 100.0):
            return HTMLResponse(content="Rate Limit Exceeded (429 Too Many Requests)", status_code=429)

    # Simulation: Latency & Jitter
    if chaos_state.latency_ms > 0 or chaos_state.latency_jitter_ms > 0:
        jitter = random.uniform(-chaos_state.latency_jitter_ms, chaos_state.latency_jitter_ms)
        total_latency_ms = max(0, chaos_state.latency_ms + jitter)
        total_latency_ms *= chaos_state.slowdown_multiplier
        if total_latency_ms > 0:
            await asyncio.sleep(total_latency_ms / 1000.0)

    # Forward the request to the actual target URL
    # Wait, Locust is going to hit /proxy... but what is the actual target URL?
    # We should pass it via the proxy path or use the global target_url.
    # Since Locust represents the user, Locust hits /proxy, and Proxy hits load_state.target_url
    target_url = load_state.target_url
    
    # In a real app we might append the path, but for a simple test we just hit the target_url
    # Let's hit the target URL directly for simplicity.
    try:
        req = client.build_request(
            request.method,
            target_url,
            headers=request.headers.raw,
            content=await request.body()
        )
        response = await client.send(req)
        return StreamingResponse(
            response.aiter_raw(),
            status_code=response.status_code,
            headers=response.headers
        )
    except Exception as e:
        return HTMLResponse(content=f"Proxy Error: {str(e)}", status_code=500)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
