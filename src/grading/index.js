export function gradeQuestion(question, selectedOptionIds) {
  const selected = [...new Set(selectedOptionIds)];
  const correct = [...new Set(question.correctOptionIds)];
  return {
    selectedOptionIds: selected,
    correctOptionIds: correct,
    isCorrect: selected.length === correct.length && selected.every((id) => correct.includes(id)),
  };
}
