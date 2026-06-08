"""
本地 LLM 推理服务 - OpenAI 兼容 API
使 AutoGen 可以通过标准 OpenAI API 接口调用本地模型
替代 Ollama，适用于无法访问 GitHub 的环境
"""

import os
import json
import time
import threading
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("LLMServer")


class LocalLLMHandler(BaseHTTPRequestHandler):
    """处理 OpenAI 兼容的 API 请求"""

    model_name = "Qwen/Qwen2.5-0.5B-Instruct"
    pipe = None
    server_start_time = time.time()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/v1/models":
            self._handle_list_models()
        elif path == "/health":
            self._handle_health()
        else:
            self._send_error(404, "Not Found")

    def do_POST(self):
        path = urlparse(self.path).path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"

        if path == "/v1/chat/completions":
            self._handle_chat_completions(body)
        elif path == "/v1/completions":
            self._handle_completions(body)
        else:
            self._send_error(404, "Not Found")

    def _handle_list_models(self):
        """返回可用模型列表"""
        data = {
            "object": "list",
            "data": [
                {
                    "id": self.model_name,
                    "object": "model",
                    "created": int(self.server_start_time),
                    "owned_by": "local",
                }
            ],
        }
        self._send_json(data)

    def _handle_health(self):
        self._send_json({"status": "ok", "model": self.model_name})

    def _handle_chat_completions(self, body):
        """处理聊天补全请求 (OpenAI 兼容格式)"""
        try:
            request = json.loads(body)
            messages = request.get("messages", [])
            temperature = request.get("temperature", 0.7)
            max_tokens = request.get("max_tokens", 2048)
            stream = request.get("stream", False)

            # 格式化输入
            prompt = self._format_chat_prompt(messages)
            logger.info(f"处理请求: {len(messages)} 条消息, {len(prompt)} 字符")

            # 推理
            start = time.time()
            response_text = self._generate(prompt, temperature, max_tokens)
            elapsed = time.time() - start
            logger.info(f"生成完成 ({elapsed:.1f}s): {len(response_text)} 字符")

            # 构造响应
            response = {
                "id": f"chatcmpl-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": self.model_name,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": response_text,
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": len(prompt) // 4,
                    "completion_tokens": len(response_text) // 4,
                    "total_tokens": (len(prompt) + len(response_text)) // 4,
                },
            }
            self._send_json(response)

        except Exception as e:
            logger.error(f"请求处理失败: {e}")
            self._send_error(500, str(e))

    def _handle_completions(self, body):
        """处理文本补全请求"""
        try:
            request = json.loads(body)
            prompt = request.get("prompt", "")
            temperature = request.get("temperature", 0.7)
            max_tokens = request.get("max_tokens", 2048)

            start = time.time()
            response_text = self._generate(prompt, temperature, max_tokens)
            elapsed = time.time() - start

            response = {
                "id": f"cmpl-{int(time.time())}",
                "object": "text_completion",
                "created": int(time.time()),
                "model": self.model_name,
                "choices": [
                    {
                        "text": response_text,
                        "index": 0,
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": len(prompt) // 4,
                    "completion_tokens": len(response_text) // 4,
                    "total_tokens": (len(prompt) + len(response_text)) // 4,
                },
            }
            self._send_json(response)

        except Exception as e:
            logger.error(f"Completion 失败: {e}")
            self._send_error(500, str(e))

    def _format_chat_prompt(self, messages):
        """将 OpenAI 格式的消息转换为模型输入"""
        formatted = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                formatted += f"<|im_start|>system\n{content}<|im_end|>\n"
            elif role == "user":
                formatted += f"<|im_start|>user\n{content}<|im_end|>\n"
            elif role == "assistant":
                formatted += f"<|im_start|>assistant\n{content}<|im_end|>\n"
        formatted += "<|im_start|>assistant\n"
        return formatted

    def _generate(self, prompt, temperature=0.7, max_tokens=2048):
        """调用模型生成文本"""
        if self.pipe is None:
            return "错误: 模型未加载"

        try:
            result = self.pipe(
                prompt,
                max_new_tokens=max_tokens,
                temperature=temperature,
                do_sample=(temperature > 0),
                pad_token_id=self.pipe.tokenizer.eos_token_id,
            )
            # 提取生成的文本（去掉输入部分）
            full_text = result[0]["generated_text"]
            # 对于聊天格式，只取 assistant 回复部分
            if "<|im_start|>assistant" in full_text:
                response = full_text.split("<|im_start|>assistant")[-1]
                response = response.replace("<|im_end|>", "").strip()
                return response
            return full_text[-500:]  # 避免输出太长
        except Exception as e:
            logger.error(f"生成失败: {e}")
            return f"生成失败: {e}"

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _send_error(self, code, message):
        self._send_json({"error": {"message": message, "type": "error"}}, code)

    def log_message(self, format, *args):
        logger.info(f"{self.client_address[0]} - {format % args}")


class LocalLLMServer:
    """本地 LLM 推理服务"""

    def __init__(self, model_name: str = "Qwen/Qwen2.5-0.5B-Instruct",
                 host: str = "0.0.0.0", port: int = 11434,
                 model_path: str = None):
        self.model_name = model_name
        self.host = host
        self.port = port
        self.model_path = model_path or os.path.expanduser(
            "~/mas-research/models"
        )
        self.server = None
        self._model_loaded = False

    def load_model(self):
        """加载模型到内存"""
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer
            import torch

            logger.info(f"正在加载模型: {self.model_name}")
            logger.info(f"模型路径: {self.model_path}")

            tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                cache_dir=self.model_path,
                trust_remote_code=True,
            )
            model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                cache_dir=self.model_path,
                torch_dtype=torch.float32,
                device_map="auto",
                trust_remote_code=True,
            )

            # 创建 pipeline
            from transformers import pipeline
            pipe = pipeline(
                "text-generation",
                model=model,
                tokenizer=tokenizer,
            )

            LocalLLMHandler.pipe = pipe
            LocalLLMHandler.model_name = self.model_name

            self._model_loaded = True
            logger.info(f"✅ 模型加载完成: {self.model_name}")

        except Exception as e:
            logger.error(f"❌ 模型加载失败: {e}")
            raise

    def start(self):
        """启动 HTTP 服务"""
        if not self._model_loaded:
            self.load_model()

        self.server = HTTPServer((self.host, self.port), LocalLLMHandler)
        logger.info(f"✅ LLM API 服务启动: http://{self.host}:{self.port}")
        logger.info(f"   模型: {self.model_name}")
        logger.info(f"   接口: /v1/chat/completions (OpenAI 兼容)")
        logger.info(f"   接口: /v1/models")
        logger.info(f"   接口: /health")

        try:
            self.server.serve_forever()
        except KeyboardInterrupt:
            logger.info("服务关闭")
            self.server.shutdown()

    def start_background(self):
        """后台启动"""
        if not self._model_loaded:
            self.load_model()

        self.server = HTTPServer((self.host, self.port), LocalLLMHandler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        logger.info(f"✅ LLM API 服务已在后台启动: http://{self.host}:{self.port}")
        return thread

    def stop(self):
        """停止服务"""
        if self.server:
            self.server.shutdown()
            logger.info("服务已停止")


# 启动脚本
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="本地 LLM API 服务")
    parser.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct",
                        help="模型名称")
    parser.add_argument("--port", type=int, default=11434, help="服务端口")
    parser.add_argument("--model-path", default=None, help="模型缓存路径")
    args = parser.parse_args()

    server = LocalLLMServer(
        model_name=args.model,
        port=args.port,
        model_path=args.model_path,
    )
    server.start()
