const AUTO_MEMORY_LIMITS = {
  look: 2,
  interact: 2,
};

function buildAutoMemoryContext(command, result) {
  if (command === 'interact') {
    return {
      location: result?.zone || null,
      limit: AUTO_MEMORY_LIMITS.interact,
    };
  }

  if (command === 'look') {
    const nearby = result?.nearby || [];
    if (nearby.length !== 1) return null;
    const focus = nearby[0];
    if (!focus?.id) return null;
    if (focus.message) return null;
    return {
      partnerId: focus.id,
      location: result?.player?.zone || focus.zone || null,
      limit: AUTO_MEMORY_LIMITS.look,
    };
  }

  return null;
}

async function appendAutoMemories(command, result, text, recallMemories, appendMemorySection) {
  const memoryContext = buildAutoMemoryContext(command, result);
  if (!memoryContext) return text;
  try {
    const memories = await recallMemories(memoryContext);
    if (!memories || memories.length === 0) return text;
    return appendMemorySection(text, memories);
  } catch {
    return text;
  }
}

module.exports = {
  AUTO_MEMORY_LIMITS,
  buildAutoMemoryContext,
  appendAutoMemories,
};
