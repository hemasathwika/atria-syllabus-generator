"""
College Scheme & Syllabus Generator - Enhanced Local App Server
Provides API endpoints for:
- Auto-saving state to JSON
- Dynamic generation and download of Scheme (.docx) separately
- Dynamic generation and download of Syllabus (.docx) separately
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import json
import traceback
import urllib.parse

PORT = 8000

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable aggressive caching for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_HEAD(self):
        if self.path.startswith('/api/download/'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            self.end_headers()
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path == '/api/save-state':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)
                
                # Save to data/default_data.json
                os.makedirs("data", exist_ok=True)
                with open("data/default_data.json", "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                
                # Regenerate both docx files using export_docx
                try:
                    import export_docx
                    export_docx.main()
                except Exception as e:
                    print(f"Warning: could not regenerate docx files: {e}")
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "message": "State saved and Word documents updated."}).encode('utf-8'))
            except Exception as e:
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/download/scheme-docx'):
            file_path = "Generated_CSE_2024_SCHEME.docx"
            if not os.path.exists(file_path):
                # Run export to generate
                try:
                    import export_docx
                    export_docx.main()
                except Exception as e:
                    print(f"Export error: {e}")
            
            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                self.send_header('Content-Disposition', 'attachment; filename="CSE_2024_SCHEME.docx"')
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                self.send_header('Content-Length', str(len(file_content)))
                self.end_headers()
                self.wfile.write(file_content)
                return
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Scheme Word document not found.")
                return

        elif self.path.startswith('/api/download/syllabus-docx'):
            parsed_url = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            course_code = query_params.get('course', ['ALL'])[0]

            try:
                import export_docx
                with open("data/default_data.json", "r", encoding="utf-8") as f:
                    data = json.load(f)
                cse_data = next((d for d in data.get("departments", []) if d.get("code") == "CSE"), None)
                
                if course_code and course_code != 'ALL':
                    file_path = f"Generated_CSE_SYLLABUS_{course_code}.docx"
                    download_filename = f"CSE_Syllabus_{course_code}.docx"
                    export_docx.generate_syllabus_docx(cse_data, output_path=file_path, filter_code=course_code)
                else:
                    file_path = "Generated_CSE_SYLLABUS.docx"
                    download_filename = "CSE_SYLLABUS_All_Courses.docx"
                    export_docx.generate_syllabus_docx(cse_data, output_path=file_path, filter_code=None)
            except Exception as e:
                print(f"Export syllabus error: {e}")
                file_path = "Generated_CSE_SYLLABUS.docx"
                download_filename = "CSE_SYLLABUS.docx"

            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                self.send_header('Content-Disposition', f'attachment; filename="{download_filename}"')
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                self.send_header('Content-Length', str(len(file_content)))
                self.end_headers()
                self.wfile.write(file_content)
                return
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Syllabus Word document not found.")
                return

        super().do_GET()

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    url = f"http://localhost:{PORT}/index.html"
    
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print("=" * 65)
        print("🎓 College Scheme & Syllabus Generator Platform")
        print("=" * 65)
        print(f"Server started at: {url}")
        print("Endpoints:")
        print("  - Web App: /index.html")
        print("  - Download Scheme Word:   /api/download/scheme-docx")
        print("  - Download Syllabus Word: /api/download/syllabus-docx")
        print("  - Save State API:         /api/save-state")
        print("=" * 65)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            httpd.server_close()
            sys.exit(0)

if __name__ == "__main__":
    main()
