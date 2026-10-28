import { describe, expect, it } from "vitest";
import { rankResumes } from "@/lib/hh/resume-selection";

const candidates = [
  { title: "Frontend developer Vue" },
  { title: "React Native mobile developer" },
  { title: "Frontend developer React TypeScript" },
  { title: "Операционный директор" },
  { title: "Backend developer Python" }
];

describe("resume ranking", () => {
  it("compares every available resume even when the selected one matches the family", () => {
    expect(rankResumes({ title: "Frontend React TypeScript" }, candidates)[0].candidate.title).toBe(candidates[2].title);
  });
  it("selects mobile for React Native", () => {
    expect(rankResumes({ title: "React Native developer" }, candidates)[0].candidate.title).toBe(candidates[1].title);
  });
  it("does not replace a frontend match because mobile is mentioned in the description", () => {
    expect(rankResumes({ title: "Frontend React developer", description: "Также есть мобильная команда React Native" }, candidates)[0].candidate.title).toBe(candidates[2].title);
  });
  it("supports management, backend and arbitrary professions", () => {
    expect(rankResumes({ title: "Операционный директор" }, candidates)[0].candidate.title).toBe(candidates[3].title);
    expect(rankResumes({ title: "Python backend engineer" }, candidates)[0].candidate.title).toBe(candidates[4].title);
    expect(rankResumes({ title: "Бухгалтер" }, [{ title: "Юрист" }, { title: "Бухгалтер" }])[0].candidate.title).toBe("Бухгалтер");
  });
  it("uses the configured resume only to break ties", () => {
    const resumes = [{ id: "aaa", title: "Frontend Vue" }, { id: "bbb", title: "Frontend React" }];
    expect(rankResumes({ title: "Frontend" }, resumes, "https://hh.ru/resume/bbb")[0].candidate.id).toBe("bbb");
    expect(rankResumes({ title: "Frontend Vue" }, resumes, "https://hh.ru/resume/bbb")[0].candidate.id).toBe("aaa");
  });
  it("works with one resume and excludes disabled ones", () => {
    expect(rankResumes({ title: "Frontend" }, [{ title: "Frontend", disabled: true }, { title: "Универсальное" }])[0].candidate.title).toBe("Универсальное");
    expect(rankResumes({ title: "Frontend" }, [])).toEqual([]);
  });
  it("pins the active profile's resume even when another title scores higher", () => {
    const resumes = [{ id: "aaa", title: "Frontend Vue" }, { id: "bbb", title: "Frontend React" }];
    expect(rankResumes({ title: "Frontend Vue" }, resumes, "https://hh.ru/resume/bbb", true)[0].candidate.id).toBe("bbb");
    expect(rankResumes({ title: "Frontend Vue" }, resumes, "https://hh.ru/resume/ccc", true)).toEqual([]);
    expect(rankResumes({ title: "Frontend Vue" }, [{ ...resumes[1], disabled: true }], "https://hh.ru/resume/bbb", true)).toEqual([]);
  });
});
