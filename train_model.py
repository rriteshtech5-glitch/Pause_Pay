import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
import joblib

def main():
    print("Generating synthetic dataset mapping to 'Panic' behaviors...")
    
    # Normal distribution: standard users typing relatively slowly, hesitating before completing the payment
    # Time measurements are in milliseconds
    normal_data = pd.DataFrame({
        'time_to_submit_ms': np.random.normal(12000, 3000, 1000),
        'click_count': np.random.normal(3, 1, 1000),
        'keystroke_count': np.random.normal(8, 2, 1000),
        'avg_typing_cadence_ms': np.random.normal(400, 100, 1000),
        'hesitation_ms': np.random.normal(2000, 800, 1000)
    })

    # Panic distribution (anomalies): extremely fast, high clicks, zero hesitation because of high cognitive load / stress
    panic_data = pd.DataFrame({
        'time_to_submit_ms': np.random.normal(4500, 1000, 50),
        'click_count': np.random.normal(6, 2, 50),
        'keystroke_count': np.random.normal(10, 2, 50),
        'avg_typing_cadence_ms': np.random.normal(120, 30, 50),
        'hesitation_ms': np.random.normal(200, 100, 50)
    })

    # Combine data
    df = pd.concat([normal_data, panic_data]).reset_index(drop=True)

    print("Training Sub-200ms ML Engine (Isolation Forest)...")
    # Isolation Forest is great for imbalanced anomaly detection. 
    # Contamination is the expected proportion of outliers (50/1050 ~ 0.05)
    model = IsolationForest(contamination=0.05, random_state=42, n_estimators=100)
    model.fit(df)

    # Save model
    model_path = "isolation_forest.pkl"
    joblib.dump(model, model_path)
    
    print(f"Model successfully saved to {model_path}.")
    print("Training Complete. The FastAPI backend is now ready to serve predictions.")

if __name__ == "__main__":
    main()
