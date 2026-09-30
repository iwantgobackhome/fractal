/** Seed queries are short named entities or techniques, not the broad arXiv field names. */
export const topicSeeds: Record<string, string[]> = {
  'cs.AI': ['OpenAI', 'Anthropic', 'Google DeepMind', 'ChatGPT', 'Codex', 'Claude', 'Gemini', 'Llama', 'AI agents', 'AI regulation'],
  'cs.CL': ['large language models', 'Claude', 'ChatGPT', 'Gemini', 'Llama', 'retrieval augmented generation', 'machine translation', 'speech recognition'],
  'cs.CV': ['computer vision', 'image recognition', 'video generation', 'diffusion models', 'object detection', 'multimodal AI', 'medical imaging'],
  'cs.LG': ['deep learning', 'reinforcement learning', 'transformers', 'foundation models', 'AI agents', 'model training', 'federated learning'],
  'cs.RO': ['humanoid robots', 'robot manipulation', 'autonomous vehicles', 'robot learning', 'Boston Dynamics', 'physical AI', 'drones'],
  'stat.ML': ['machine learning', 'causal inference', 'Bayesian inference', 'neural networks', 'probabilistic models', 'federated learning'],
  'q-bio.NC': ['neuroscience', 'brain computer interfaces', 'neural circuits', 'Neuralink', 'Alzheimer research', 'neuroimaging'],
  'quant-ph': ['quantum computing', 'quantum error correction', 'qubits', 'quantum entanglement', 'quantum cryptography', 'IBM Quantum'],
  'cond-mat.mtrl-sci': ['battery materials', 'superconductors', 'semiconductors', 'graphene', 'perovskites', 'materials discovery'],
  'eess.AS': ['speech recognition', 'audio generation', 'voice cloning', 'noise cancellation', 'acoustic sensing', 'text to speech'],
  'eess.IV': ['medical imaging', 'image processing', 'computer vision', 'video analysis', 'image reconstruction', 'remote sensing'],
};
