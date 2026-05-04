INSERT INTO slash_commands (name, description, type, action) VALUES (
  'draw',
  'Generate an image from a prompt using Gemini.',
  'ai_prompt',
  'You MUST immediately call the generate_image tool with the user''s message as the prompt. Do not write any text reply, do not ask clarifying questions, do not narrate what you are doing. Just call generate_image once and stop.'
) ON CONFLICT (name) DO NOTHING;
