#!/usr/bin/env node

/**
 * Test script to verify prompt cleaning is working correctly
 */

// Simulate the extractVisualDescription function
function extractVisualDescription(sceneContent) {
  // Start with the raw content
  let description = sceneContent.trim();

  // Remove markdown metadata if present
  if (description.startsWith("---")) {
    const endOfMetadata = description.indexOf("---", 3);
    if (endOfMetadata !== -1) {
      description = description.substring(endOfMetadata + 3).trim();
    }
  }

  // Remove dialogue (text in quotes)
  description = description.replace(/"[^"]*"/g, "");
  description = description.replace(/'[^']*'/g, "");

  // Remove character names and dialogue markers more aggressively
  description = description.replace(/^[A-Za-z]+\s*:/gm, "");
  description = description.replace(/\b[A-Za-z]+\s*:/g, "");
  description = description.replace(/^[A-Za-z]+\s*\(/gm, "");

  // Remove chapter/episode titles and headers
  description = description.replace(/^(Chapter|Episode)\s+\d+.*$/gm, "");
  description = description.replace(/^[A-Z][A-Za-z\s]+$/gm, ""); // Remove title-like lines

  // Extract and preserve visual cues in brackets or parentheses
  const visualCues = [];
  const bracketMatches = description.match(/\[[^\]]+\]/g);
  const parenMatches = description.match(/\([^)]+\)/g);

  if (bracketMatches) {
    visualCues.push(...bracketMatches.map((m) => m.slice(1, -1).trim()));
  }
  if (parenMatches) {
    visualCues.push(...parenMatches.map((m) => m.slice(1, -1).trim()));
  }

  // Remove visual cues from main description
  description = description.replace(/\[[^\]]+\]/g, "");
  description = description.replace(/\([^)]+\)/g, "");

  // Clean up markdown and formatting
  description = description.replace(/[#*_`]/g, "");
  description = description.replace(/\*\*/g, "");
  description = description.replace(/_{2,}/g, "");

  // Remove problematic characters that cause Bedrock issues
  description = description.replace(/[:\[\]{}]/g, "");
  description = description.replace(/\s+/g, " ");

  // Split into sentences and filter meaningful ones
  const sentences = description
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      // Filter out very short sentences, single words, or character names
      return (
        sentence.length > 10 &&
        !sentence.match(/^[A-Za-z]+$/) && // Single words
        !sentence.match(/^[A-Za-z]+\s+[A-Za-z]+$/) && // Two words (likely names)
        sentence.includes(" ") // Must have spaces (actual sentences)
      );
    });

  // Take the most descriptive sentences
  let finalDescription = sentences.slice(0, 3).join(". ");

  // Add visual cues if we have them
  if (visualCues.length > 0) {
    const cleanedCues = visualCues
      .map((cue) => cue.replace(/[:\[\]{}]/g, "").trim())
      .filter((cue) => cue.length > 5);
    if (cleanedCues.length > 0) {
      finalDescription += ". " + cleanedCues.slice(0, 2).join(". ");
    }
  }

  // Final cleanup
  finalDescription = finalDescription
    .replace(/[:\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();

  // Ensure we have meaningful content
  if (finalDescription.length < 15) {
    finalDescription =
      "A dramatic manga scene with characters in intense action";
  }

  // Limit description length for Bedrock (keep it shorter)
  if (finalDescription.length > 300) {
    finalDescription = finalDescription.substring(0, 300).trim();
    // Ensure we don't cut off mid-word
    const lastSpace = finalDescription.lastIndexOf(" ");
    if (lastSpace > 250) {
      finalDescription = finalDescription.substring(0, lastSpace);
    }
  }

  // Create a clean, simple prompt for Stable Diffusion
  const cleanPrompt = `Manga illustration of ${finalDescription}`;

  return cleanPrompt;
}

// Simulate the enhancePromptForManga function
function enhancePromptForManga(prompt, style) {
  // Start with a very clean base prompt
  let cleanPrompt = prompt.trim();

  // Remove any potentially problematic characters that Stability AI doesn't like
  cleanPrompt = cleanPrompt
    .replace(/['"]/g, "") // Remove quotes
    .replace(/[:;]/g, "") // Remove colons and semicolons
    .replace(/[{}[\]]/g, "") // Remove brackets
    .replace(/[#*_]/g, "") // Remove markdown
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();

  // Keep it simple and short - Stability AI prefers concise prompts
  if (cleanPrompt.length > 200) {
    cleanPrompt = cleanPrompt.substring(0, 200).trim();
    // Don't cut mid-word
    const lastSpace = cleanPrompt.lastIndexOf(" ");
    if (lastSpace > 150) {
      cleanPrompt = cleanPrompt.substring(0, lastSpace);
    }
  }

  // Create a simple, safe prompt format
  const safePrompt = `${cleanPrompt}, manga style, black and white, detailed line art`;

  return safePrompt;
}

// Test with problematic content from the logs
const testCases = [
  "Shattered Bonds Akira's mind was numb as he held his sister's lifeless body. Kitsune's sacrifice had...",
  "Memories flooded back of the day Kitsune was ripped from their family, a victim of the Black Lotus's...",
  "Nakamura snarled, His elite assassins, known as the Shadows, remained motionless but their cold eyes...",
  "Akira: Takeshi : Takeshi: Hiro:. Back at the tower, a swirling vortex of darkness...",
  "Episode 1: The Sword's Curse Takeshi: Akira lets out a guttural...",
];

console.log("🧪 Testing Prompt Cleaning\n");

testCases.forEach((testCase, index) => {
  console.log(`Test Case ${index + 1}:`);
  console.log(`Original: "${testCase}"`);

  const cleaned = extractVisualDescription(testCase);
  console.log(`Cleaned: "${cleaned}"`);

  const enhanced = enhancePromptForManga(cleaned, "manga style");
  console.log(`Enhanced: "${enhanced}"`);

  console.log(`Length: ${enhanced.length} characters`);
  console.log(`Has problematic chars: ${/[:\[\]{}'"]/g.test(enhanced)}`);
  console.log("---\n");
});
