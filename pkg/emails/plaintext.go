package emails

import (
	"strconv"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// RenderText is the plain-text version of an email body for one recipient: the
// merge fields resolved, the Markdown reduced to readable text (headings as
// plain lines, links as "text (url)", list items as "- item", rules and other
// syntax dropped), and decorations as emoji. It is the text/plain part of every
// send and the source of the inbox preview line, where raw Markdown such as
// "## Hotel Blocks" or "---" would otherwise show.
func RenderText(body string, mctx MergeContext) string {
	return replaceDecorations(markdownToText(resolveMergeFields(body, mctx)), decorationEmoji)
}

// markdownToText parses source with the same goldmark configuration the HTML
// uses, so both versions agree on the structure, and writes it back out as
// plain text.
func markdownToText(source string) string {
	src := []byte(source)
	doc := markdown.Parser().Parse(text.NewReader(src))
	var blocks []string
	for n := doc.FirstChild(); n != nil; n = n.NextSibling() {
		if b := blockText(n, src); b != "" {
			blocks = append(blocks, b)
		}
	}
	return strings.Join(blocks, "\n\n")
}

// blockText renders one block node.
func blockText(n ast.Node, src []byte) string {
	switch n := n.(type) {
	case *ast.ThematicBreak, *ast.HTMLBlock:
		return ""
	case *ast.CodeBlock, *ast.FencedCodeBlock:
		var b strings.Builder
		lines := n.Lines()
		for i := 0; i < lines.Len(); i++ {
			seg := lines.At(i)
			b.Write(seg.Value(src))
		}
		return strings.TrimRight(b.String(), "\n")
	case *ast.List:
		var items []string
		number := n.Start
		for item := n.FirstChild(); item != nil; item = item.NextSibling() {
			marker := "- "
			if n.IsOrdered() {
				marker = strconv.Itoa(number) + ". "
				number++
			}
			// Continuation lines of an item line up under its text.
			indent := "\n" + strings.Repeat(" ", len(marker))
			items = append(items, marker+strings.ReplaceAll(childBlocksText(item, src, "\n"), "\n", indent))
		}
		return strings.Join(items, "\n")
	case *ast.Paragraph, *ast.TextBlock, *ast.Heading:
		return strings.TrimSpace(inlineText(n, src))
	default:
		// Blockquotes, list items, and anything else: their child blocks.
		return childBlocksText(n, src, "\n\n")
	}
}

// childBlocksText renders a node's child blocks joined by sep.
func childBlocksText(n ast.Node, src []byte, sep string) string {
	var parts []string
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		if b := blockText(c, src); b != "" {
			parts = append(parts, b)
		}
	}
	return strings.Join(parts, sep)
}

// inlineText renders the inline content under n.
func inlineText(n ast.Node, src []byte) string {
	var b strings.Builder
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch c := c.(type) {
		case *ast.Text:
			// Resolve backslash escapes and entity references the way the
			// HTML renderer does, so "\*" and "&amp;" read as "*" and "&".
			b.Write(unescapeText(c.Segment.Value(src)))
			// Hard wraps are on, so a single newline is a line break in the
			// HTML too.
			if c.SoftLineBreak() || c.HardLineBreak() {
				b.WriteString("\n")
			}
		case *ast.String:
			b.Write(c.Value)
		case *ast.Link:
			label := inlineText(c, src)
			dest := string(c.Destination)
			if label == "" || label == dest {
				b.WriteString(dest)
			} else {
				b.WriteString(label + " (" + dest + ")")
			}
		case *ast.AutoLink:
			b.Write(c.URL(src))
		case *ast.Image:
			b.WriteString(inlineText(c, src))
		case *ast.CodeSpan:
			// Code is literal: a backslash or "&amp;" inside it stays as typed.
			for t := c.FirstChild(); t != nil; t = t.NextSibling() {
				if seg, ok := t.(*ast.Text); ok {
					b.Write(seg.Segment.Value(src))
				}
			}
		case *ast.RawHTML:
			// Dropped, as the HTML version drops it.
		default:
			// Emphasis and the like: just their text.
			b.WriteString(inlineText(c, src))
		}
	}
	return b.String()
}

// unescapeText resolves Markdown backslash escapes and HTML entity references
// in a text segment, matching what goldmark's HTML writer does on output.
func unescapeText(v []byte) []byte {
	return util.ResolveEntityNames(util.ResolveNumericReferences(util.UnescapePunctuations(v)))
}
