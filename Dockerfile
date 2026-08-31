FROM python:3.12-slim
WORKDIR /app
COPY . /app
RUN python -m pip install --no-cache-dir -r requirements.txt
EXPOSE 8000
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "echo 'Cipherion: starting Render web server on port' ${PORT:-8000}; python -m uvicorn render_boot:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info"]
