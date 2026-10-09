export const SCANNER_PROFILE_FIELDS = {
  date_of_birth: { label: "Date of Birth", type: "date" },
  course: { label: "Highest Educational Attainment", type: "text" },
  pwd: { label: "PWD", options: ["Yes", "No"] },
  sex: { label: "Sex", options: ["Male", "Female"] },
  first_time_job_seeker: { label: "FIRST TIME JOB SEEKER", options: ["yes", "no"] },
  returning_ofw: { label: "RETURNING OFW", options: ["yes", "no"] },
  returning_worker: { label: "RETURNING WORKER", options: ["yes", "no"] },
  interested_in_skills_training: { label: "INTERESTED IN SKILLS TRAINING", options: ["Yes", "No"] },
  province: { label: "Province", type: "text" },
  municipality_city: { label: "Municipality/City", type: "text" },
  barangay: { label: "Barangay", type: "text" },
};

export const PROFILE_CLASSIFICATION_KEYS = ["first_time_job_seeker", "returning_ofw", "returning_worker"];
export const PROFILE_ADDRESS_KEYS = { province: "province", city: "municipality_city", barangay: "barangay" };

export function initialProfileAnswers(fields) {
  const defaults = { pwd: "No", sex: "Female", first_time_job_seeker: "yes",
    returning_ofw: "no", returning_worker: "no", interested_in_skills_training: "Yes" };
  return Object.fromEntries(fields.map((key) => [key, defaults[key] ?? ""]));
}

export function changeProfileAnswer(current, field, value, fields) {
  const next = { ...current, [field]: value };
  if (value === "yes" && PROFILE_CLASSIFICATION_KEYS.includes(field)) {
    for (const key of PROFILE_CLASSIFICATION_KEYS) {
      if (key !== field && fields.includes(key)) next[key] = "no";
    }
  }
  return next;
}

// Address parent selections can provide lookup context when only a child is
// missing. Save only the requested fields; existing answers stay intact.
export function profileAnswersToSave(fields, answers) {
  return Object.fromEntries(fields.map((key) => [key, answers[key] ?? ""]));
}
