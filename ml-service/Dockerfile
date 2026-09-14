FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Train only when the repository did not ship the model files.
RUN [ -f price_model.pkl ] || python train_model.py; \
    [ -f demand_model.pkl ] || python train_demand_model.py

ENV ML_HOST=0.0.0.0 PORT=8000 FLASK_DEBUG=0
EXPOSE 8000
CMD ["python", "app.py"]
