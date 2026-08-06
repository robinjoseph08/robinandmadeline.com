package server_test

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const canonicalBaseURL = "https://www.robinandmadeline.com"

func publicFile(t *testing.T, name string) []byte {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	content, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "public", name))
	require.NoError(t, err)
	return content
}

func TestSitemap_ListsPublicLandingRoutes(t *testing.T) {
	var sitemap struct {
		XMLName xml.Name
		URLs    []struct {
			Location string `xml:"loc"`
		} `xml:"url"`
	}
	require.NoError(t, xml.Unmarshal(publicFile(t, "sitemap.xml"), &sitemap))
	assert.Equal(t, "urlset", sitemap.XMLName.Local)
	assert.Equal(t, "http://www.sitemaps.org/schemas/sitemap/0.9", sitemap.XMLName.Space)

	actual := make([]string, 0, len(sitemap.URLs))
	for _, entry := range sitemap.URLs {
		actual = append(actual, entry.Location)
	}
	assert.Equal(t, []string{
		canonicalBaseURL + "/",
		canonicalBaseURL + "/story",
		canonicalBaseURL + "/schedule",
		canonicalBaseURL + "/travel",
		canonicalBaseURL + "/games",
		canonicalBaseURL + "/photos",
		canonicalBaseURL + "/faq",
		canonicalBaseURL + "/rsvp",
	}, actual)

	for _, excluded := range []string{"/admin", "/i/", "/u/", "/rsvp/form", "/rsvp/confirmation", "/games/proposal", "/games/mini", "/games/crossword"} {
		assert.NotContains(t, actual, canonicalBaseURL+excluded)
	}
}

func TestRobots_DiscouragesPrivateAndIntermediateCrawling(t *testing.T) {
	robots := string(publicFile(t, "robots.txt"))
	assert.Contains(t, robots, "Crawl guidance only. These rules are not access controls.")

	var directives []string
	for _, line := range strings.Split(robots, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			directives = append(directives, line)
		}
	}
	assert.Equal(t, []string{
		"User-agent: *",
		"Disallow: /admin",
		"Disallow: /i/",
		"Disallow: /u/",
		"Disallow: /rsvp/form",
		"Disallow: /rsvp/confirmation",
		"Sitemap: " + canonicalBaseURL + "/sitemap.xml",
	}, directives)
}
