// Command emailpreview serves an editable preview of the HTML email, so its
// design can be iterated on without the app, a database, or a real send. The
// page edits a subject and Markdown body (seeded with the sample email and saved
// to the browser's localStorage, so edits survive a reload or restart) and
// renders them through the same RenderEmail pipeline a real send uses, against
// sample merge values. The shell's hosted images and fonts are served from this
// checkout's public/email instead of the live site. With Mailgun configured in
// .env, the page can also send the draft to real inboxes (see sender). Run it
// with `mise preview:email`, which rebuilds on any .go or .html change; the
// open page notices the new build and re-renders.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
)

// previewBaseURL is the site origin the sample merge links point at.
const previewBaseURL = "https://www.robinandmadeline.com"

// renderRequest is the editor's current draft. WebFonts off previews the
// email the way clients without web font support (Gmail, Outlook) show it.
type renderRequest struct {
	Subject  string `json:"subject"`
	Body     string `json:"body"`
	WebFonts bool   `json:"web_fonts"`
}

// The shell's web font hooks, stripped when previewing without web fonts.
var (
	fontLinkRE = regexp.MustCompile(`<link[^>]*fonts\.googleapis\.com[^>]*>`)
	fontFaceRE = regexp.MustCompile(`@font-face\s*\{[^}]*\}`)
)

// renderResponse is the draft rendered for the sample recipient: the resolved
// subject, the full HTML email, and the plain-text fallback, matching what the
// worker sends (worker.go).
type renderResponse struct {
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
}

func main() {
	log := logger.New()
	// A fixed port keeps the page on the same origin across restarts, which is
	// what keeps its localStorage (the saved draft) visible.
	port := flag.Int("port", 4400, "preferred port; a free one is used if it is taken")
	sendTo := flag.String("send-to", os.Getenv("EMAIL_PREVIEW_SEND_TO"),
		"comma-separated addresses the Send button mails the draft to (default EMAIL_TEST_RECIPIENTS)")
	flag.Parse()

	// The same .env the API server loads, for the Mailgun keys and test inboxes.
	_ = godotenv.Load()
	cfg, err := config.New()
	if err != nil {
		log.Err(err).Fatal("load config")
	}
	to := cfg.EmailTestRecipients
	if *sendTo != "" {
		to = nil
		for _, addr := range strings.Split(*sendTo, ",") {
			if addr = strings.TrimSpace(addr); addr != "" {
				to = append(to, addr)
			}
		}
	}
	snd, unavailable := newSender(cfg, to)

	listener, err := listen(*port)
	if err != nil {
		log.Err(err).Fatal("listen")
	}
	addr := listener.Addr().(*net.TCPAddr)
	if addr.Port != *port {
		log.Warn("preferred port is taken; edits saved on it will not show here", logger.Data{"port": *port})
	}
	log.Info(fmt.Sprintf("Email preview: http://localhost:%d", addr.Port))

	server := &http.Server{Handler: routes(snd, unavailable, log), ReadHeaderTimeout: 10 * time.Second}
	if err := server.Serve(listener); err != nil {
		log.Err(err).Fatal("serve")
	}
}

// isLocalHost reports whether a request's Host header names this machine.
func isLocalHost(hostport string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		host = hostport
	}
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func listen(port int) (net.Listener, error) {
	lc := net.ListenConfig{}
	if l, err := lc.Listen(context.Background(), "tcp", "localhost:"+strconv.Itoa(port)); err == nil {
		return l, nil
	}
	return lc.Listen(context.Background(), "tcp", "localhost:0")
}

func routes(snd *sender, unavailable string, log logger.Logger) http.Handler {
	// build identifies this process, so the page can tell when air has swapped
	// in a rebuilt binary and re-render with the new shell.
	build := strconv.FormatInt(time.Now().UnixNano(), 10)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		data := map[string]any{
			"Defaults":    renderRequest{Subject: emails.SampleSubject, Body: emails.SampleBody},
			"Unavailable": unavailable,
			"MergeFields": emails.MergeFieldNames(),
			"Decorations": emails.DecorationNames(),
		}
		if snd != nil {
			data["SendTo"] = strings.Join(snd.to, ", ")
		}
		_ = page.Execute(w, data)
	})
	mux.HandleFunc("GET /build", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(build))
	})
	mux.HandleFunc("POST /render", func(w http.ResponseWriter, r *http.Request) {
		var req renderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("decode draft: %v", err), http.StatusBadRequest)
			return
		}
		mctx := emails.SampleMergeContext(previewBaseURL)
		html := emails.RenderEmail(req.Subject, req.Body, mctx)
		// Load the hosted images and fonts from this checkout rather than the
		// live site, so changes to them show before they deploy.
		html = strings.ReplaceAll(html, previewBaseURL+emails.EmailAssetPath, emails.EmailAssetPath)
		if !req.WebFonts {
			html = fontFaceRE.ReplaceAllString(fontLinkRE.ReplaceAllString(html, ""), "")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(renderResponse{
			Subject: emails.Render(req.Subject, mctx),
			HTML:    html,
			Text:    emails.RenderText(req.Body, mctx),
		})
	})
	mux.HandleFunc("POST /send", func(w http.ResponseWriter, r *http.Request) {
		// This sends real mail, so only this page may trigger it: any other
		// site open in the same browser could otherwise POST here. A JSON body
		// cannot be sent cross-origin without a preflight this server never
		// answers, a browser always names the page's origin on a POST, and a
		// localhost-only Host header rules out DNS rebinding (where a hostile
		// name resolves to this machine and Origin and Host both match it).
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") ||
			!isLocalHost(r.Host) ||
			(r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host) {
			http.Error(w, "only the preview page can send", http.StatusForbidden)
			return
		}
		if snd == nil {
			http.Error(w, unavailable, http.StatusServiceUnavailable)
			return
		}
		var req renderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf("decode draft: %v", err), http.StatusBadRequest)
			return
		}
		if err := snd.send(r.Context(), req.Subject, req.Body); err != nil {
			log.Err(err).Error("send preview")
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	// mise runs this from the repository root, where public/email lives.
	mux.Handle("GET "+emails.EmailAssetPath+"/", http.StripPrefix(emails.EmailAssetPath, http.FileServer(http.Dir("public"+emails.EmailAssetPath))))
	return mux
}

var page = template.Must(template.New("page").Parse(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Email preview</title>
<style>
*{box-sizing:border-box}
body{margin:0;display:flex;height:100vh;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;background:#ebe9e4;color:#161822}
aside{width:420px;flex:none;display:flex;flex-direction:column;gap:10px;padding:16px;background:#fff;border-right:1px solid #dcd9d2}
aside h1{margin:0;font-size:16px}
label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6b6c72}
.toggle{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0;color:#161822}
.toggle input{width:auto}
input,textarea{width:100%;padding:8px 10px;border:1px solid #cfccc4;border-radius:6px;font:13px/1.5 ui-monospace,Menlo,monospace;color:inherit}
textarea{flex:1;resize:none}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.hint{margin:0;font-size:12px;color:#6b6c72}
.hint code{font-size:11px}
button{padding:4px 10px;border:1px solid #cfccc4;border-radius:6px;background:#fff;font:inherit;font-size:12px;cursor:pointer}
button:hover{border-color:#f25477;color:#f25477}
button:disabled{opacity:.6;cursor:default}
#status{font-size:12px;color:#6b6c72}
main{flex:1;padding:20px 24px;overflow:auto}
.subject{font-size:18px;font-weight:600;margin:0 0 16px}
.panes{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.pane h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b6c72}
iframe{display:block;border:1px solid #cfccc4;border-radius:8px;background:#fff;min-height:400px}
pre{margin:0;width:420px;padding:16px;background:#fff;border:1px solid #cfccc4;border-radius:8px;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,Menlo,monospace}
</style></head><body>
<aside>
<div class="row"><h1>Email preview</h1><span id="status"></span></div>
<label for="subject">Subject</label>
<input id="subject" spellcheck="false">
<label for="body">Body (Markdown)</label>
<textarea id="body" spellcheck="false"></textarea>
<p class="hint">Merge fields:{{range .MergeFields}} <code>{{"{{"}}{{.}}}}</code>{{end}}</p>
<p class="hint">Hearts:{{range .Decorations}} <code>{{"{{"}}{{.}}}}</code>{{end}}</p>
<label class="toggle"><input id="webfonts" type="checkbox" checked> Web fonts (Apple Mail); off shows Gmail and Outlook</label>
<p class="hint">A paragraph that is only a link renders as a button.</p>
<div class="row"><p class="hint">Edits save in this browser.</p><button id="reset" type="button">Reset to sample</button></div>
{{if .SendTo}}<div class="row"><button id="send" type="button">Send to {{.SendTo}}</button><span id="send-status" class="hint"></span></div>
{{else}}<p class="hint">{{.Unavailable}}</p>{{end}}
</aside>
<main>
<p class="subject" id="rendered-subject"></p>
<div class="panes">
<div class="pane"><h3>Phone</h3><iframe id="phone" title="Phone preview" width="375"></iframe></div>
<div class="pane"><h3>Desktop</h3><iframe id="desktop" title="Desktop preview" width="680"></iframe></div>
<div class="pane"><h3>Plain text</h3><pre id="text"></pre></div>
</div></main>
<script>
const defaults = {{.Defaults}};
const storageKey = "emailpreview:draft";
const fontsKey = "emailpreview:webfonts";
const webFonts = document.getElementById("webfonts");
webFonts.checked = localStorage.getItem(fontsKey) !== "off";
webFonts.addEventListener("change", () => {
  localStorage.setItem(fontsKey, webFonts.checked ? "on" : "off");
  render();
});
const subject = document.getElementById("subject");
const body = document.getElementById("body");
const status = document.getElementById("status");
const frames = [document.getElementById("phone"), document.getElementById("desktop")];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.subject === "string" && typeof saved.body === "string") return saved;
  } catch {}
  return defaults;
}

function show(draft) {
  subject.value = draft.subject;
  body.value = draft.body;
}

async function render() {
  try {
    const res = await fetch("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject.value, body: body.value, web_fonts: webFonts.checked }),
    });
    if (!res.ok) throw new Error(await res.text());
    const out = await res.json();
    document.getElementById("rendered-subject").textContent = out.subject;
    document.getElementById("text").textContent = out.text;
    for (const frame of frames) frame.srcdoc = out.html;
    status.textContent = "";
  } catch (err) {
    status.textContent = "Render failed: " + err.message;
  }
}

// Grow each frame to its content so the whole email shows without inner scroll.
for (const frame of frames) {
  frame.addEventListener("load", () => {
    frame.style.height = frame.contentDocument.documentElement.scrollHeight + "px";
  });
}

let timer;
function changed() {
  localStorage.setItem(storageKey, JSON.stringify({ subject: subject.value, body: body.value }));
  clearTimeout(timer);
  timer = setTimeout(render, 150);
}
subject.addEventListener("input", changed);
body.addEventListener("input", changed);

document.getElementById("reset").addEventListener("click", () => {
  if (!confirm("Replace your edits with the sample email?")) return;
  localStorage.removeItem(storageKey);
  show(defaults);
  render();
});

// Re-render when air swaps in a rebuilt binary (a shell.html or Go change).
let build;
async function poll() {
  try {
    const next = await (await fetch("/build")).text();
    if (build !== undefined && next !== build) render();
    else if (status.textContent === "Rebuilding...") status.textContent = "";
    build = next;
  } catch {
    status.textContent = "Rebuilding...";
  }
  setTimeout(poll, 1000);
}

const send = document.getElementById("send");
if (send) {
  const sendStatus = document.getElementById("send-status");
  send.addEventListener("click", async () => {
    send.disabled = true;
    sendStatus.textContent = "Sending...";
    try {
      const res = await fetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.value, body: body.value }),
      });
      if (!res.ok) throw new Error(await res.text());
      sendStatus.textContent = "Sent at " + new Date().toLocaleTimeString();
    } catch (err) {
      sendStatus.textContent = "Send failed: " + err.message;
    } finally {
      send.disabled = false;
    }
  });
}

show(load());
render();
poll();
</script>
</body></html>`))
