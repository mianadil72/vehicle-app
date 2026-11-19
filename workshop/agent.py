import os

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    AgentEndpointConfig,
    FixedRatioVersionSelectionRule,
    PromptAgentDefinition,
    ProtocolConfiguration,
    ResponsesProtocolConfiguration,
    VersionSelector,
)
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

load_dotenv(override=True)

agent_name = "vehicle-new-agent-gpt-mini"

with (
    DefaultAzureCredential() as credential,
    AIProjectClient(
        endpoint=os.environ["PROJECT_ENDPOINT"],
        credential=credential,
    ) as project_client,
):
    agent_version = None
    original_agent_endpoint = None

    try:
        agent_version = project_client.agents.create_version(
            agent_name=agent_name,
            definition=PromptAgentDefinition(
                model=os.environ["MODEL_DEPLOYMENT_NAME"],
                instructions=(
                    "You are a helpful assistant for a car dealership. Help customers "
                    "find vehicles in our inventory and answer questions about make, "
                    "model, year, price, category, condition and mileage. If you don't "
                    "know something, say so rather than guessing."
                ),
            ),
        )
        print(
            f"Agent created (id: {agent_version.id}, name: {agent_version.name}, "
            f"version: {agent_version.version})"
        )

        original_agent_endpoint = project_client.agents.get(
            agent_name=agent_name
        ).agent_endpoint
        project_client.agents.update_details(
            agent_name=agent_name,
            agent_endpoint=AgentEndpointConfig(
                version_selector=VersionSelector(
                    version_selection_rules=[
                        FixedRatioVersionSelectionRule(
                            agent_version=agent_version.version,
                            traffic_percentage=100,
                        ),
                    ]
                ),
                protocol_configuration=ProtocolConfiguration(
                    responses=ResponsesProtocolConfiguration()
                ),
            ),
        )

        with project_client.get_openai_client(
            agent_name=agent_name
        ) as openai_client:
            conversation = openai_client.conversations.create()
            print(f"Create Conversation, ID: {conversation.id}")

            try:
                while True:
                    user_input = input("You: ")
                    if user_input.lower() in ("exit", "quit"):
                        break

                    openai_client.conversations.items.create(
                        conversation_id=conversation.id,
                        items=[
                            {
                                "type": "message",
                                "role": "user",
                                "content": user_input,
                            }
                        ],
                    )
                    response = openai_client.responses.create(
                        conversation=conversation.id
                    )
                    print(response.output_text)
            finally:
                openai_client.conversations.delete(
                    conversation_id=conversation.id
                )
    finally:
        if original_agent_endpoint is not None:
            project_client.agents.update_details(
                agent_name=agent_name,
                agent_endpoint=original_agent_endpoint,
            )

        if agent_version is not None:
            project_client.agents.delete_version(
                agent_name=agent_name,
                agent_version=agent_version.version,
                force=True,
            )
            print("Deleted agent version")
