#!/usr/bin/env python3
"""只向本机提供应用运行文件，不提供源码配置或上级目录。"""
import argparse
import http.server
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]

class AppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_GET(self):
        path=unquote(urlsplit(self.path).path)
        # Source/config/Git contain no runtime assets and need not be served.
        first=path.strip('/').split('/')[0]
        if '..' in path.split('/') or first not in ('','index.html','assets','data','diagnose','LICENSE','favicon.ico'):
            self.send_error(404);return
        if path.endswith('/') and path!='/':
            self.send_error(404);return
        super().do_GET()
    def do_HEAD(self):
        path=unquote(urlsplit(self.path).path)
        if '..' in path.split('/') or path.strip('/').split('/')[0] not in ('','index.html','assets','data','diagnose','LICENSE','favicon.ico'):
            self.send_error(404);return
        super().do_HEAD()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        super().end_headers()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8768);a=p.parse_args()
    with http.server.ThreadingHTTPServer(('127.0.0.1',a.port),AppHandler) as server:
        print(f'苏州小学数学知识地图：http://127.0.0.1:{a.port}/',flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
