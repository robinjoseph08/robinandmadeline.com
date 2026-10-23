package games

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDescribeUserAgent(t *testing.T) {
	tests := []struct {
		name string
		ua   string
		want clientDescription
	}{
		{
			name: "Safari on iPhone",
			ua:   "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
			want: clientDescription{Browser: "Safari 18", OS: "iOS 18.1", Device: "iPhone"},
		},
		{
			name: "Chrome on iPhone keeps its own name",
			ua:   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
			want: clientDescription{Browser: "Chrome 126", OS: "iOS 17.5", Device: "iPhone"},
		},
		{
			name: "Instagram in-app browser",
			ua:   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 618023787)",
			want: clientDescription{Browser: "Instagram App 337", OS: "iOS 17.5", Device: "iPhone"},
		},
		{
			name: "Safari on iPad",
			ua:   "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
			want: clientDescription{Browser: "Safari 17", OS: "iOS 17.5", Device: "iPad"},
		},
		{
			name: "Chrome on Mac drops the frozen macOS version",
			ua:   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
			want: clientDescription{Browser: "Chrome 126", OS: "macOS", Device: "Mac"},
		},
		{
			name: "Edge on Windows drops the frozen Windows version",
			ua:   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
			want: clientDescription{Browser: "Edge 126", OS: "Windows", Device: "Desktop"},
		},
		{
			name: "Chrome on Android with the reduced UA hides the fake version and model",
			ua:   "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
			want: clientDescription{Browser: "Chrome 126", OS: "Android", Device: "Android phone"},
		},
		{
			name: "Samsung Browser keeps the real Android version and model",
			ua:   "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
			want: clientDescription{Browser: "Samsung Browser 25", OS: "Android 14", Device: "SM-S918B"},
		},
		{
			name: "Firefox on Linux drops the architecture",
			ua:   "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
			want: clientDescription{Browser: "Firefox 127", OS: "Linux", Device: "Desktop"},
		},
		{
			name: "unrecognized string yields nothing",
			ua:   "games-service-test",
			want: clientDescription{},
		},
		{
			name: "blank",
			ua:   "",
			want: clientDescription{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, describeUserAgent(tt.ua))
		})
	}
}
