import pytest
from app.agents.parallel_analysis import (
    ParallelAnalysisOrchestrator,
    QAGradingOrchestrator,
    RevisionOrchestrator,
    AgentResult,
)
from app.models.schemas import GuardrailSchema, Annotation, QAScorecard


class TestParallelAnalysisOrchestrator:
    @pytest.fixture
    def orchestrator(self):
        return ParallelAnalysisOrchestrator()

    @pytest.fixture
    def guardrail(self):
        return GuardrailSchema()

    @pytest.fixture
    def sample_slides(self):
        return [
            {
                "index": 0,
                "title": "Executive Summary",
                "full_text": "Revenue increased by 25% in Q4.",
                "text_boxes": [{"id": "tb1", "text": "Executive Summary", "runs": []}],
                "charts": [],
                "width": 10.0,
                "height": 7.5,
            },
            {
                "index": 1,
                "title": "Problem Statement",
                "full_text": "We face significant challenges in the market.",
                "text_boxes": [],
                "charts": [],
                "width": 10.0,
                "height": 7.5,
            },
            {
                "index": 2,
                "title": "Recommendation",
                "full_text": "We recommend implementing the new strategy.",
                "text_boxes": [],
                "charts": [],
                "width": 10.0,
                "height": 7.5,
            },
        ]

    @pytest.mark.asyncio
    async def test_insight_extractor_finds_claims(
        self, orchestrator, guardrail, sample_slides
    ):
        result = await orchestrator.run_insight_extractor(sample_slides, guardrail)

        assert result.agent_name == "Insight Extractor"
        assert result.score > 0
        assert isinstance(result.findings, list)

    @pytest.mark.asyncio
    async def test_structure_auditor_checks_narrative(
        self, orchestrator, guardrail, sample_slides
    ):
        result = await orchestrator.run_structure_auditor(sample_slides, guardrail)

        assert result.agent_name == "Structure Auditor"
        assert "headlines_checked" in result.metadata

    @pytest.mark.asyncio
    async def test_visual_analysis_checks_density(
        self, orchestrator, guardrail, sample_slides
    ):
        result = await orchestrator.run_visual_analysis_agent(sample_slides, guardrail)

        assert result.agent_name == "Visual Analysis Agent"
        assert "slides_checked" in result.metadata

    @pytest.mark.asyncio
    async def test_data_lineage_with_no_excel(self, orchestrator, sample_slides):
        result = await orchestrator.run_data_lineage_agent(sample_slides, None)

        assert result.agent_name == "Data Lineage Agent"
        assert (
            result.metadata.get("note")
            == "No Excel source — charts flagged as unverified"
        )

    @pytest.mark.asyncio
    async def test_run_parallel_analysis(self, orchestrator, guardrail, sample_slides):
        results = await orchestrator.run_parallel_analysis(
            sample_slides, guardrail, None
        )

        assert len(results) >= 4
        agent_names = [r.agent_name for r in results]
        assert "Insight Extractor" in agent_names
        assert "Structure Auditor" in agent_names
        assert "Data Lineage Agent" in agent_names
        assert "Visual Analysis Agent" in agent_names


class TestQAGradingOrchestrator:
    @pytest.fixture
    def grader(self):
        return QAGradingOrchestrator()

    @pytest.fixture
    def sample_agent_results(self):
        return [
            AgentResult(
                agent_name="Insight Extractor",
                findings=[],
                score=85,
                metadata={},
            ),
            AgentResult(
                agent_name="Structure Auditor",
                findings=[],
                score=80,
                metadata={},
            ),
            AgentResult(
                agent_name="Data Lineage Agent",
                findings=[],
                score=95,
                metadata={},
            ),
            AgentResult(
                agent_name="Visual Analysis Agent",
                findings=[],
                score=75,
                metadata={},
            ),
        ]

    @pytest.mark.asyncio
    async def test_calculate_composite_score(self, grader, sample_agent_results):
        scorecard = grader.calculate_scorecard(
            sample_agent_results, [], GuardrailSchema()
        )

        assert scorecard.composite_score > 0
        assert scorecard.claim_grounding_score == 85
        assert scorecard.structure_score == 80

    @pytest.mark.asyncio
    async def test_hard_block_zeros_score(self, grader, sample_agent_results):
        hard_block_annotation = Annotation(
            slide_index=0,
            text="Ungrounded claim",
            category="claim_grounding",
            severity="hard_block",
            message="No evidence found",
        )

        scorecard = grader.calculate_scorecard(
            sample_agent_results, [hard_block_annotation], GuardrailSchema()
        )

        assert scorecard.composite_score == 0
        assert scorecard.hard_block_count > 0


class TestRevisionOrchestrator:
    @pytest.fixture
    def reviser(self):
        return RevisionOrchestrator(max_attempts=3)

    @pytest.mark.asyncio
    async def test_should_revise_on_hard_block(self, reviser):
        scorecard = QAScorecard(
            composite_score=80,
            hard_block_count=1,
        )

        should = await reviser.should_revise(scorecard, attempt=0)
        assert should

    @pytest.mark.asyncio
    async def test_should_not_revise_after_max_attempts(self, reviser):
        scorecard = QAScorecard(
            composite_score=60,
            hard_block_count=0,
        )

        should = await reviser.should_revise(scorecard, attempt=3)
        assert not should

    @pytest.mark.asyncio
    async def test_apply_auto_remediation(self, reviser):
        scorecard = QAScorecard(
            composite_score=75,
            annotations=[
                Annotation(
                    slide_index=0,
                    text="Their is an error",
                    category="grammar",
                    severity="warning",
                    message="Grammar error",
                    suggestion="There is an error",
                ),
                Annotation(
                    slide_index=1,
                    text="Ungrounded claim",
                    category="claim_grounding",
                    severity="hard_block",
                    message="No evidence",
                ),
            ],
        )

        fixes = await reviser.apply_auto_remediation(scorecard, [])

        grammar_fixes = [f for f in fixes if f.get("suggested_text")]
        assert len(grammar_fixes) > 0
