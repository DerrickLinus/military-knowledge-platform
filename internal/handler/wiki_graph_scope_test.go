package handler

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/gin-gonic/gin"
)

type wikiGraphKnowledgeServiceStub struct {
	interfaces.KnowledgeService
	items []*types.Knowledge
	err   error
}

func (s *wikiGraphKnowledgeServiceStub) GetKnowledgeBatchWithSharedAccess(
	context.Context,
	uint64,
	[]string,
) ([]*types.Knowledge, error) {
	return s.items, s.err
}

func wikiGraphQueryContext(rawQuery string) *gin.Context {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/wiki/graph?"+rawQuery, nil)
	return c
}

func TestParseWikiGraphKnowledgeIDs(t *testing.T) {
	t.Run("absent means unscoped", func(t *testing.T) {
		ids, present, err := parseWikiGraphKnowledgeIDs(wikiGraphQueryContext("mode=overview"))
		if err != nil || present || ids != nil {
			t.Fatalf("ids=%v present=%v err=%v", ids, present, err)
		}
	})

	t.Run("trims and deduplicates", func(t *testing.T) {
		ids, present, err := parseWikiGraphKnowledgeIDs(
			wikiGraphQueryContext("knowledge_ids=doc-1%2C+doc-2%2Cdoc-1"),
		)
		if err != nil || !present || len(ids) != 2 || ids[0] != "doc-1" || ids[1] != "doc-2" {
			t.Fatalf("ids=%v present=%v err=%v", ids, present, err)
		}
	})

	t.Run("present empty is rejected", func(t *testing.T) {
		_, present, err := parseWikiGraphKnowledgeIDs(wikiGraphQueryContext("knowledge_ids="))
		if !present || err == nil {
			t.Fatalf("present=%v err=%v", present, err)
		}
	})

	t.Run("enforces max", func(t *testing.T) {
		parts := make([]string, wikiGraphMaxKnowledge+1)
		for i := range parts {
			parts[i] = fmt.Sprintf("doc-%d", i)
		}
		_, _, err := parseWikiGraphKnowledgeIDs(
			wikiGraphQueryContext("knowledge_ids=" + strings.Join(parts, "%2C")),
		)
		if err == nil {
			t.Fatal("expected max-ID validation error")
		}
	})
}

func TestValidateWikiGraphKnowledgeIDs(t *testing.T) {
	h := &WikiPageHandler{knowledgeService: &wikiGraphKnowledgeServiceStub{items: []*types.Knowledge{
		{ID: "doc-1", KnowledgeBaseID: "kb-1"},
		{ID: "doc-2", KnowledgeBaseID: "kb-1"},
	}}}
	if err := h.validateWikiGraphKnowledgeIDs(context.Background(), "kb-1", 7, []string{"doc-1", "doc-2"}); err != nil {
		t.Fatalf("valid scope rejected: %v", err)
	}
	if err := h.validateWikiGraphKnowledgeIDs(context.Background(), "kb-2", 7, []string{"doc-1"}); err == nil {
		t.Fatal("expected cross-KB scope to be rejected")
	}

	h.knowledgeService = &wikiGraphKnowledgeServiceStub{items: []*types.Knowledge{
		{ID: "doc-1", KnowledgeBaseID: "kb-1"},
	}}
	if err := h.validateWikiGraphKnowledgeIDs(context.Background(), "kb-1", 7, []string{"doc-1", "doc-missing"}); err == nil {
		t.Fatal("expected missing knowledge ID to be rejected")
	}
}
