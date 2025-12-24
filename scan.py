import urllib.request
import json
import time
import sys

# --- 設定 ---
TOKEN = "JXeWdITivc2N0neAHWYxpriQcRpiiOvF2vJmIhBgnSs"
OPENAPI_URL = "https://api.adultdatalink.com/openapi.json"
BASE_URL = "https://api.adultdatalink.com"

# 顏色代碼 (讓 Windows MINGW 也能顯示顏色)
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    RESET = '\033[0m'

def get_json(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"{Colors.RED}Failed to download OpenAPI spec: {e}{Colors.RESET}")
        sys.exit(1)

def fetch_api(path):
    # 填充路徑參數 (智慧替換)
    path = path.replace("{video_id}", "12345")
    path = path.replace("{id}", "1")
    path = path.replace("{category}", "anal")
    path = path.replace("{pornstar_name}", "mia-khalifa")
    path = path.replace("{username}", "admin")
    path = path.replace("{keyword}", "teen")
    path = path.replace("{q}", "latest")
    
    # 加上基本 Query String (避免 422 錯誤)
    full_url = f"{BASE_URL}{path}?q=latest&page=1&sort=date"
    
    req = urllib.request.Request(
        full_url, 
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "User-Agent": "AutoScanner/1.0"
        }
    )

    try:
        with urllib.request.urlopen(req) as response:
            return response.getcode(), response.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)

def main():
    print("-" * 50)
    print("1. Downloading OpenAPI Spec...")
    spec = get_json(OPENAPI_URL)
    
    paths = spec.get("paths", {})
    print(f"   Found {len(paths)} paths definition.")
    print("-" * 50)
    print("2. Starting Scan...")
    print("-" * 50)

    for path, methods in paths.items():
        # 只測試 GET 方法
        if "get" not in methods:
            continue
            
        print(f"[TEST] {path:<40}", end=" ... ", flush=True)
        
        status, body = fetch_api(path)
        
        if status == 200:
            print(f"{Colors.GREEN}SUCCESS (200){Colors.RESET}")
            # 如果你想看內容，可以取消下面這行的註解
            # print(body[:100]) 
        elif status == 404:
            print(f"{Colors.RED}NOT FOUND (404){Colors.RESET}")
        elif status in [400, 422]:
            print(f"{Colors.YELLOW}PARAM ERROR ({status}){Colors.RESET}")
            # 嘗試解析錯誤訊息
            try:
                err_json = json.loads(body)
                msg = err_json.get('detail') or err_json.get('message') or "Unknown error"
                # 如果 detail 是列表 (Pydantic 常見格式)，轉成字串
                if isinstance(msg, list):
                    msg = str(msg)
                print(f"       -> Hint: {msg}")
            except:
                print(f"       -> Raw: {body[:50]}...")
        else:
            print(f"{Colors.RED}FAILED ({status}){Colors.RESET}")

        # 避免請求過快
        time.sleep(0.2)

    print("-" * 50)
    print("Scan Complete.")

if __name__ == "__main__":
    main()