"""Unit tests for agent.py. No Azure calls: the Foundry client, credential and input() are mocked.

Run from this folder:  python -m unittest -v test_agent
"""

import os
import runpy
import unittest
from pathlib import Path
from unittest import mock

AGENT_SCRIPT = str(Path(__file__).with_name("agent.py"))
AGENT_NAME = "vehicle-new-agent-gpt-mini"
ENV = {"PROJECT_ENDPOINT": "https://example.test/api/projects/p", "MODEL_DEPLOYMENT_NAME": "test-model"}


class AgentScriptTest(unittest.TestCase):
    def setUp(self):
        # Fake project client, returned by the `with AIProjectClient(...) as project_client` block.
        self.project = mock.MagicMock(name="project_client")
        self.version = mock.MagicMock(id="ver-id", version="7")
        self.version.name = AGENT_NAME
        self.project.agents.create_version.return_value = self.version
        self.original_endpoint = mock.sentinel.original_endpoint
        self.project.agents.get.return_value.agent_endpoint = self.original_endpoint

        # Fake OpenAI client, returned by `with project_client.get_openai_client(...) as openai_client`.
        self.openai = mock.MagicMock(name="openai_client")
        self.openai.conversations.create.return_value.id = "conv-1"
        self.openai.responses.create.return_value.output_text = "We have 2 SUVs."
        self.project.get_openai_client.return_value.__enter__.return_value = self.openai

        client_cls = mock.MagicMock(name="AIProjectClient")
        client_cls.return_value.__enter__.return_value = self.project
        self.client_cls = client_cls

    def run_script(self, inputs):
        """Runs agent.py as a script with the given lines typed at the `You:` prompt."""
        with (
            mock.patch.dict(os.environ, ENV),
            mock.patch("azure.ai.projects.AIProjectClient", self.client_cls),
            mock.patch("azure.identity.DefaultAzureCredential", mock.MagicMock()),
            mock.patch("dotenv.load_dotenv"),
            mock.patch("builtins.input", side_effect=inputs),
            mock.patch("builtins.print") as printed,
        ):
            runpy.run_path(AGENT_SCRIPT, run_name="__main__")
        return [" ".join(map(str, c.args)) for c in printed.call_args_list]

    # --- The agent name -------------------------------------------------------------------------

    def test_uses_new_agent_name_everywhere(self):
        self.run_script(["exit"])
        agents = self.project.agents
        self.assertEqual(agents.create_version.call_args.kwargs["agent_name"], AGENT_NAME)
        self.assertEqual(agents.get.call_args.kwargs["agent_name"], AGENT_NAME)
        self.assertEqual(self.project.get_openai_client.call_args.kwargs["agent_name"], AGENT_NAME)
        for c in agents.update_details.call_args_list:
            self.assertEqual(c.kwargs["agent_name"], AGENT_NAME)
        self.assertEqual(agents.delete_version.call_args.kwargs["agent_name"], AGENT_NAME)

    def test_old_agent_name_is_gone(self):
        source = Path(AGENT_SCRIPT).read_text(encoding="utf-8")
        self.assertNotIn('"vehicle-agent"', source)

    def test_connects_with_project_endpoint_and_model(self):
        self.run_script(["exit"])
        self.assertEqual(self.client_cls.call_args.kwargs["endpoint"], ENV["PROJECT_ENDPOINT"])
        definition = self.project.agents.create_version.call_args.kwargs["definition"]
        self.assertEqual(definition.model, "test-model")
        self.assertIn("car dealership", definition.instructions)

    # --- Endpoint routing -------------------------------------------------------------------------

    def test_routes_all_traffic_to_new_version_then_restores_original(self):
        self.run_script(["exit"])
        calls = self.project.agents.update_details.call_args_list
        self.assertEqual(len(calls), 2)
        rule = calls[0].kwargs["agent_endpoint"].version_selector.version_selection_rules[0]
        self.assertEqual(rule.agent_version, "7")
        self.assertEqual(rule.traffic_percentage, 100)
        self.assertIs(calls[1].kwargs["agent_endpoint"], self.original_endpoint)

    # --- Chat loop --------------------------------------------------------------------------------

    def test_sends_each_message_and_prints_reply(self):
        printed = self.run_script(["Any SUVs?", "Under $40k?", "exit"])
        sent = [c.kwargs["items"][0]["content"] for c in self.openai.conversations.items.create.call_args_list]
        self.assertEqual(sent, ["Any SUVs?", "Under $40k?"])
        for c in self.openai.conversations.items.create.call_args_list:
            self.assertEqual(c.kwargs["conversation_id"], "conv-1")
            self.assertEqual(c.kwargs["items"][0]["role"], "user")
        self.assertEqual(self.openai.responses.create.call_count, 2)
        self.assertEqual(printed.count("We have 2 SUVs."), 2)

    def test_quit_is_case_insensitive(self):
        self.run_script(["QUIT"])
        self.openai.conversations.items.create.assert_not_called()
        self.openai.responses.create.assert_not_called()

    # --- Cleanup ----------------------------------------------------------------------------------

    def test_normal_exit_deletes_conversation_and_version(self):
        printed = self.run_script(["exit"])
        self.openai.conversations.delete.assert_called_once_with(conversation_id="conv-1")
        self.project.agents.delete_version.assert_called_once_with(agent_name=AGENT_NAME, agent_version="7", force=True)
        self.assertIn("Deleted agent version", printed)

    def test_error_mid_chat_still_cleans_up(self):
        self.openai.responses.create.side_effect = RuntimeError("service down")
        with self.assertRaises(RuntimeError):
            self.run_script(["hello"])
        self.openai.conversations.delete.assert_called_once_with(conversation_id="conv-1")
        self.assertIs(self.project.agents.update_details.call_args.kwargs["agent_endpoint"], self.original_endpoint)
        self.project.agents.delete_version.assert_called_once()

    def test_ctrl_c_still_cleans_up(self):
        with self.assertRaises(KeyboardInterrupt):
            self.run_script(KeyboardInterrupt())
        self.openai.conversations.delete.assert_called_once()
        self.project.agents.delete_version.assert_called_once()

    def test_failed_create_touches_nothing(self):
        self.project.agents.create_version.side_effect = RuntimeError("quota")
        with self.assertRaises(RuntimeError):
            self.run_script(["exit"])
        self.project.agents.update_details.assert_not_called()
        self.project.agents.delete_version.assert_not_called()


if __name__ == "__main__":
    unittest.main()
