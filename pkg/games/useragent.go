package games

import (
	"strings"

	"github.com/mileusna/useragent"
)

// clientDescription is the human-readable summary of a stored User-Agent that
// the admin sessions list shows next to the raw string. Each field is blank
// when the parser could not recognize that part, so the UI can fall back to the
// raw User-Agent.
type clientDescription struct {
	Browser string
	OS      string
	Device  string
}

// describeUserAgent parses a raw User-Agent into a browser, OS, and device
// summary. It runs at read time rather than being stored, so improvements to
// the parsing apply to every past session too.
//
// Modern browsers deliberately freeze parts of the string, and this reports
// what is knowable rather than repeating the frozen values:
//   - Chrome and Edge on Windows always claim "Windows NT 10.0", even on
//     Windows 11, so the Windows version is dropped.
//   - Every macOS browser claims 10.15.x, so the macOS version is dropped. iPads
//     also request desktop sites by default and look like a Mac.
//   - Chrome on Android sends "Android 10; K" regardless of the real OS version
//     and model, so that pair is reported as just "Android" on an "Android
//     phone".
//   - iPhones never report their model number.
//
// Only the browser's major version is kept; the minor and patch numbers add
// noise without helping identify anyone.
func describeUserAgent(raw string) clientDescription {
	if strings.TrimSpace(raw) == "" {
		return clientDescription{}
	}
	ua := useragent.Parse(raw)
	// The parser falls back to the first product token as the browser name, so
	// an unrecognized string (no OS and no form factor) would otherwise surface
	// junk like "games-service-test" as a browser.
	if ua.OS == "" && !ua.Mobile && !ua.Tablet && !ua.Desktop {
		return clientDescription{}
	}

	reducedAndroid := ua.OS == useragent.Android && ua.Device == "K"

	return clientDescription{
		Browser: joinNonBlank(ua.Name, majorVersion(ua.Version)),
		OS:      describeOS(ua, reducedAndroid),
		Device:  describeDevice(ua, reducedAndroid),
	}
}

func describeOS(ua useragent.UserAgent, reducedAndroid bool) string {
	switch ua.OS {
	case useragent.Windows, useragent.MacOS, useragent.Linux, useragent.ChromeOS:
		// Frozen (Windows, macOS) or meaningless (Linux reports the CPU
		// architecture), so the bare name is the honest answer.
		return ua.OS
	case useragent.Android:
		if reducedAndroid {
			return ua.OS
		}
	}
	return joinNonBlank(ua.OS, ua.OSVersion)
}

func describeDevice(ua useragent.UserAgent, reducedAndroid bool) string {
	switch {
	case ua.Bot:
		return "Bot"
	case ua.Device != "" && !reducedAndroid:
		return ua.Device
	case ua.Tablet && ua.OS == useragent.Android:
		return "Android tablet"
	case ua.Mobile && ua.OS == useragent.Android:
		return "Android phone"
	case ua.Tablet:
		return "Tablet"
	case ua.Mobile:
		return "Phone"
	case ua.OS == useragent.MacOS:
		return "Mac"
	case ua.Desktop:
		return "Desktop"
	}
	return ""
}

// majorVersion trims "126.0.6478.54" down to "126".
func majorVersion(version string) string {
	major, _, _ := strings.Cut(version, ".")
	return major
}

func joinNonBlank(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, " ")
}
