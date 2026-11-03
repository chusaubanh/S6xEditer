import { describe, expect, it } from "vitest";
import { checkAgainstSource, checkLabels, checkLength, checkScript, checkSpokenNumbers, renderScriptReview } from "../src/training/script-checks";
import { musicKeyTimes, planClips, planSfx } from "../src/training/placement";
import { buildTimeline, secToFrames, TrainingScriptSchema, type TrainingScript } from "../src/training/training-contract";

const GROUP = { title: "g", contentType: "danh-sach", learnerNeeds: "n", mustKeep: ["m"], canDrop: [], examples: [], delivery: "x" };

const base = (over: Record<string, unknown> = {}, scene: Record<string, unknown> = {}): TrainingScript =>
  TrainingScriptSchema.parse({
    version: "4.0",
    documentName: "d",
    title: "t",
    aspect: "16:9",
    voice: { id: "v", tone: "tu_nhien" },
    targetAudience: "a",
    analysis: { contentGroups: [GROUP], learningLogic: "l", principles: ["p"], fitsOneVideo: true },
    lengthDecision: { status: "single", confirmedBy: "u" },
    scenes: [{ id: "s", section: "S", contentType: "danh-sach", component: "c", voiceSegments: ["Im lặng ba mươi phút."], visual: ["Đồng hồ quay."], labels: [], ...scene }],
    ...over,
  });

const SOURCE = "Nhắn Alo rồi im lặng 30 phút gây phân tán.";

describe("câu chào thương hiệu", () => {
  const issues = (text: string) => checkScript(base({}, { voiceSegments: [text] }), SOURCE).filter((i) => i.message.startsWith("too-short"));
  it("chỉ miễn lỗi quá ngắn cho đúng tên thương hiệu", () => {
    expect(issues("Công ty Mẫu.")).toEqual([]);
    expect(issues("Câu ngắn thôi.")).toHaveLength(1);
  });
});

describe("hợp đồng", () => {
  it("bắt buộc mỗi câu có một mô tả hình", () => {
    expect(() => base({}, { visual: ["a dài dài", "b dài dài"] })).toThrow();
  });
  it("không đủ một video thì phải ghi lossIfForced", () => {
    expect(() => base({ analysis: { contentGroups: [GROUP], learningLogic: "l", principles: ["p"], fitsOneVideo: false } })).toThrow();
  });
  it("chỉ nhận 4 khổ đã chốt", () => {
    expect(() => base({ aspect: "3:5" })).toThrow();
    expect(base({ aspect: "4:5" }).aspect).toBe("4:5");
  });
});

describe("đối chiếu nguồn", () => {
  it("bắt số sai so với tài liệu", () => {
    const issues = checkAgainstSource(base({}, { voiceSegments: ["Chờ 15 phút."] }), SOURCE);
    expect(issues.map((issue) => issue.message).join()).toContain("15");
  });
  it("bắt nhãn có từ lạ, nhận nhãn đúng nguồn", () => {
    expect(checkAgainstSource(base({}, { labels: ["Campaign Tết"] }), SOURCE)).toHaveLength(1);
    expect(checkAgainstSource(base({}, { labels: ["im lặng", "30 phút"] }), SOURCE)).toHaveLength(0);
  });
});

describe("số đọc bằng chữ", () => {
  const issues = (sentence: string, source = SOURCE) =>
    checkSpokenNumbers(base({}, { voiceSegments: [sentence] }), source);
  it("bắt số sai: tài liệu ghi 30 phút, lời đọc nói mười lăm phút", () => {
    expect(issues("Chờ mười lăm phút rồi nhắn lại.")).toHaveLength(1);
  });
  it("nhận số đúng, kể cả tài liệu viết bằng chữ", () => {
    expect(issues("Im lặng ba mươi phút rồi mới nhắn.")).toHaveLength(0);
    expect(issues("Gửi trước mười sáu giờ chiều nay.", "trước mười sáu giờ chiều nay")).toHaveLength(0);
  });
  it("không nhầm từ thường với số", () => {
    expect(issues("Một người chịu trách nhiệm chính.")).toHaveLength(0);
    expect(issues("Hai bên cùng trao đổi với nhau.")).toHaveLength(0);
  });
  it("bắt số đếm theo đơn vị", () => {
    expect(issues("Làm theo năm bước sau đây.", "Làm theo 3 bước")).toHaveLength(1);
    expect(issues("Làm theo ba bước sau đây.", "Làm theo 3 bước")).toHaveLength(0);
  });
});

describe("nhãn", () => {
  it("bắt nhãn quá dài và nhãn chép lời đọc", () => {
    expect(checkLabels(base({}, { labels: ["một hai ba bốn năm sáu bảy tám chín"] }))).toHaveLength(1);
    const copied = base({}, { voiceSegments: ["Luôn phản hồi trong chuỗi hội thoại nhé."], labels: ["Luôn phản hồi trong chuỗi hội"] });
    expect(checkLabels(copied)).toHaveLength(1);
  });
});

describe("cổng thời lượng", () => {
  it("đang chờ chốt thì báo lỗi", () => {
    expect(checkLength(base({ lengthDecision: { status: "pending" } }))[0]?.level).toBe("error");
  });
  it("quá 195 giây mà chưa tách thì báo lỗi", () => {
    const long = Array.from({ length: 80 }, () => "Một câu đủ dài để cộng dồn thời lượng của toàn bộ video này lên.");
    const script = base({}, { voiceSegments: long, visual: long });
    expect(checkLength(script).some((issue) => issue.message.includes("tách"))).toBe(true);
  });
  it("người dùng chấp nhận vượt mức thì không chặn", () => {
    const long = Array.from({ length: 80 }, () => "Một câu đủ dài để cộng dồn thời lượng của toàn bộ video này lên.");
    const script = base({ lengthDecision: { status: "single", confirmedBy: "u", overLimitAccepted: true } }, { voiceSegments: long, visual: long });
    expect(checkLength(script)).toHaveLength(0);
  });
  it("video ngắn hơn 3 phút vẫn hợp lệ", () => {
    expect(checkScript(base(), SOURCE).filter((issue) => issue.level === "error")).toHaveLength(0);
  });
});

describe("bảng duyệt và timeline", () => {
  it("có đủ cột theo brief và tổng thời lượng", () => {
    const review = renderScriptReview(base());
    expect(review).toContain("Nội dung lồng tiếng");
    expect(review).toContain("Nội dung trực quan");
    expect(review).toContain("Tổng thời lượng ước tính");
  });
  it("mốc giờ lấy từ thời lượng đo được", () => {
    const script = base({}, { voiceSegments: ["Câu một đây.", "Câu hai đây."], visual: ["hình một", "hình hai"] });
    const timeline = buildTimeline(script, "job", () => 2);
    expect(timeline.scenes[0]?.sentences[1]?.startSec).toBeCloseTo(2.12);
    expect(timeline.totalSec).toBeCloseTo(4.52);
  });
});

describe("xếp lớp CapCut", () => {
  const script = base({ music: { src: "m.mp3", underVoice: 0.1, inGap: 0.2, fadeInSec: 1, fadeOutSec: 2 } }, {
    voiceSegments: ["Im lặng ba mươi phút.", "Câu thứ hai đủ dài."],
    visual: ["Đồng hồ quay.", "Đồng hồ dừng."],
    sfx: [
      { src: "a.mp3", sentence: 0, fraction: 0, volume: 0.5, hitSec: 0 },
      { src: "b.mp3", sentence: 0, fraction: 0.1, volume: 0.5, hitSec: 0 },
      { src: "a.mp3", sentence: 1, fraction: 0.5, volume: 0.5, hitSec: 0 },
    ],
  });
  const timeline = buildTimeline(script, "j", () => 2);
  it("tiếng chồng nhau sang làn khác, hết chồng thì về làn đầu", () => {
    expect(planSfx(script, timeline, () => 1).map((item) => item.lane)).toEqual([0, 1, 0]);
  });
  it("các đoạn cảnh ghép lại đủ tổng số khung", () => {
    const clips = planClips(timeline);
    expect(clips[0].fromFrame).toBe(0);
    expect(clips.at(-1)?.toFrame).toBe(secToFrames(timeline.totalSec));
  });
  it("mốc nhạc nằm trong video và có đầu cuối", () => {
    const keys = musicKeyTimes(script, timeline);
    expect(keys[0]).toBe(0);
    expect(keys.at(-1)).toBe(timeline.totalSec);
  });
});
