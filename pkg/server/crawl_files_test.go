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

func TestSitemap_ListsOnlyPublicLandingRoutes(t *testing.T) {
	var sitemap struct {
		URLs []struct {
			Location string `xml:"loc"`
		} `xml:"url"`
	}
	require.NoError(t, xml.Unmarshal(publicFile(t, "sitemap.xml"), &sitemap))

	actual := make([]string, 0, len(sitemap.URLs))
	for _, entry := range sitemap.URLs {
		actual = append(actual, strings.TrimPrefix(entry.Location, canonicalBaseURL))
	}
	assert.Equal(t, []string{
		"/", "/story", "/schedule", "/travel", "/games", "/photos", "/faq", "/rsvp",
	}, actual)

	for _, excluded := range []string{"/admin", "/i/", "/u/", "/rsvp/form", "/rsvp/confirmation", "/games/mini"} {
		assert.NotContains(t, actual, excluded)
	}
}

func TestRobots_DiscouragesPrivateAndIntermediateCrawling(t *testing.T) {
	robots := string(publicFile(t, "robots.txt"))
	assert.Contains(t, robots, "Crawl guidance only. These rules are not access controls.")
	assert.Contains(t, robots, "User-agent: *")
	for _, path := range []string{"/admin", "/games/", "/i/", "/u/", "/rsvp/form", "/rsvp/confirmation"} {
		assert.Contains(t, robots, "Disallow: "+path+"\n")
	}
	assert.NotContains(t, robots, "Disallow: /rsvp\n")
	assert.Contains(t, robots, "Sitemap: "+canonicalBaseURL+"/sitemap.xml")
}
