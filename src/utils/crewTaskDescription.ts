export interface CrewTaskDescriptionInput {
  categoryName: string;
  subItems?: readonly string[] | null;
}

export function formatCrewTaskDescription(input: CrewTaskDescriptionInput): string {
  const categoryName = String(input.categoryName || '').trim();
  const subItems = (input.subItems || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return subItems.length > 0
    ? `${categoryName} (${subItems.join(', ')})`
    : categoryName;
}
