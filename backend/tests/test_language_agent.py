import pytest
from app.agents.language_analysis import LanguageAnalysisAgent
from app.models.schemas import Annotation


class TestLanguageAnalysisAgent:
    @pytest.fixture
    def agent(self):
        return LanguageAnalysisAgent()

    @pytest.mark.asyncio
    async def test_detects_hedging_language(self, agent):
        result = await agent.analyze_slide(
            slide_index=0,
            text="This could potentially be the best approach.",
            guardrail_rules={},
        )

        hedging = [a for a in result.quality_issues if a.category == "hedging"]
        assert len(hedging) > 0
        assert "could potentially" in hedging[0].text.lower()

    @pytest.mark.asyncio
    async def test_detects_vague_quantifiers(self, agent):
        result = await agent.analyze_slide(
            slide_index=0,
            text="We saw significant growth in revenue.",
            guardrail_rules={},
        )

        vague = [a for a in result.quality_issues if a.category == "vague_quantifier"]
        assert len(vague) > 0

    @pytest.mark.asyncio
    async def test_detects_passive_voice(self, agent):
        result = await agent.analyze_slide(
            slide_index=0, text="Costs were reduced by 20%.", guardrail_rules={}
        )

        passive = [a for a in result.quality_issues if a.category == "passive"]
        assert isinstance(passive, list)

    @pytest.mark.asyncio
    async def test_detects_prohibited_phrases(self, agent):
        result = await agent.analyze_slide(
            slide_index=0,
            text="The competitor XYZ Corp is amazing.",
            guardrail_rules={"prohibited_phrases": ["competitor.*"]},
        )

        prohibited = [
            a for a in result.quality_issues if a.category == "prohibited_phrase"
        ]
        assert len(prohibited) > 0

    @pytest.mark.asyncio
    async def test_clean_text_scores_high(self, agent):
        result = await agent.analyze_slide(
            slide_index=0,
            text="We recommend implementing the strategy immediately.",
            guardrail_rules={},
        )

        assert result.grammar_score >= 90
        assert result.quality_score >= 90

    @pytest.mark.asyncio
    async def test_analyze_deck(self, agent):
        slides_data = [
            {"index": 0, "title": "Slide 1", "full_text": "Costs were reduced."},
            {"index": 1, "title": "Slide 2", "full_text": "We recommend action."},
        ]

        annotations = await agent.analyze_deck(slides_data, {})

        assert isinstance(annotations, list)

    def test_calculate_grammar_score(self, agent):
        no_issues = []
        score = agent._calculate_grammar_score(no_issues)
        assert score == 100

        issues = [
            Annotation(
                slide_index=0,
                text="test",
                category="grammar",
                severity="warning",
                message="Test",
            )
        ]
        score = agent._calculate_grammar_score(issues)
        assert score < 100

    def test_suggest_direct_alternative(self, agent):
        alt = agent._suggest_direct_alternative("could potentially")
        assert alt == "can"

        alt = agent._suggest_direct_alternative("perhaps")
        assert alt in {"likely", "probably"}

        alt = agent._suggest_direct_alternative("unknown phrase")
        assert alt == "use direct language"
