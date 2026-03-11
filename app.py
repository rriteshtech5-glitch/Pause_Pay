from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import joblib
import time
import os
import sqlite3
import json
from fastapi.middleware.cors import CORSMiddleware
from typing import List

app = FastAPI(title="Panic Risk Scoring Engine", description="Sub-200ms Behavioral Edge Inference")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DeviceFingerprint(BaseModel):
    user_agent: str
    platform: str
    screen_resolution: str
    language: str

class BehaviorPayload(BaseModel):
    time_to_submit_ms: int
    click_count: int
    keystroke_count: int
    backspace_count: int
    avg_typing_cadence_ms: int
    hesitation_ms: int
    mouse_movements: int
    device_fingerprint: DeviceFingerprint = None

# Database Setup
DB_PATH = os.path.join(os.path.dirname(__file__), "soc_transactions.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            risk_score REAL,
            panic_detected BOOLEAN,
            inference_time_ms REAL,
            behavior_data TEXT,
            device_data TEXT
        )
    ''')
    conn.commit()
    conn.close()

MODEL_PATH = os.path.join(os.path.dirname(__file__), "isolation_forest.pkl")
model = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

@app.on_event("startup")
def load_model():
    global model
    init_db()  # Initialize database on startup
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print("Scikit-Learn Isolation Forest loaded successfully!")
    else:
        print("Warning: Model not found. Run train_model.py first. Running in heuristic failure mode.")

@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/evaluate_risk")
async def evaluate_risk(payload: BehaviorPayload):
    start_time = time.time()
    
    # Data columns in train_model.py:
    # 1. time_to_submit_ms
    # 2. click_count
    # 3. keystroke_count
    # 4. avg_typing_cadence_ms
    # 5. hesitation_ms
    features = [[
        payload.time_to_submit_ms,
        payload.click_count,
        payload.keystroke_count,
        payload.avg_typing_cadence_ms,
        payload.hesitation_ms
    ]]
    
    risk_score = 0
    is_panic = False
    
    if model:
        prediction = model.predict(features)[0]
        score_samples = model.score_samples(features)[0] 
        

        
        # Inverse the score so positive = high risk
        raw_anomaly_score = -score_samples
        
        base_risk = (raw_anomaly_score * 150) # Scale it up
        risk_score = min(max(base_risk, 0), 100)
        
        # Hard thresholding for demo purposes to ensure "Panic" behaves as expected 
        if prediction == -1: 
            risk_score = max(risk_score, 85.0) # Ensure anomalies look risky
            is_panic = True
        else:
            # For standard normal interactions, soften the score
            risk_score = min(risk_score, 45.0)
            is_panic = False
            
        
        if payload.time_to_submit_ms < 8000 or payload.avg_typing_cadence_ms < 250 or payload.hesitation_ms < 1000:
            is_panic = True
            risk_score = 95.0
            
    else:
        # Heuristic Fallback in case ML isn't enabled
        is_panic = payload.time_to_submit_ms < 8000 or payload.avg_typing_cadence_ms < 250 or payload.hesitation_ms < 1000
        risk_score = 92 if is_panic else 15
        
    inference_time_ms = (time.time() - start_time) * 1000
    
    response_data = {
        "risk_score": round(risk_score, 2),
        "panic_detected": bool(is_panic),
        "inference_time_ms": round(inference_time_ms, 2),
        "latency_status": "PASS (<200ms)" if inference_time_ms < 200 else "FAIL"
    }

    # Store in database
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    behavior_json = json.dumps(payload.dict(exclude={'device_fingerprint'}))
    device_json = json.dumps(payload.device_fingerprint.dict() if payload.device_fingerprint else {})
    timestamp_ms = int(time.time() * 1000)
    
    c.execute('''
        INSERT INTO transactions (timestamp, risk_score, panic_detected, inference_time_ms, behavior_data, device_data)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (timestamp_ms, response_data["risk_score"], response_data["panic_detected"], response_data["inference_time_ms"], behavior_json, device_json))
    
    tx_id = c.lastrowid
    conn.commit()
    conn.close()

    # Broadcast to dashboard
    tx_event = {
        "id": tx_id,
        "timestamp": timestamp_ms,
        "risk_score": response_data["risk_score"],
        "panic_detected": response_data["panic_detected"],
        "behavior": payload.dict(exclude={'device_fingerprint'}),
        "device": payload.device_fingerprint.dict() if payload.device_fingerprint else {}
    }
    await manager.broadcast(tx_event)
    
    return response_data

@app.get("/transactions")
def get_transactions(limit: int = 50):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?', (limit,))
        rows = c.fetchall()
        
        transactions = []
        for row in rows:
            transactions.append({
                "id": row["id"],
                "timestamp": row["timestamp"],
                "risk_score": row["risk_score"],
                "panic_detected": bool(row["panic_detected"]),
                "inference_time_ms": row["inference_time_ms"],
                "behavior": json.loads(row["behavior_data"]),
                "device": json.loads(row["device_data"])
            })
        conn.close()
        return {"status": "success", "data": transactions}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(app, host="0.0.0.0", port=8002)
