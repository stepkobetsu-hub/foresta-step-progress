export type GoalJapaneseUnit = {
  unitId: string;
  unitOrder: number;
  unitType: string;
  title: string;
  hasLct: boolean;
};

// 2026年度フォレスタゴール国語（原本: FG中学国語）の57単元。
// D1の教材マスタ欠落を自己修復するため、Apps Script正本の単元ID・順序・名称を保持する。
export const GOAL_JAPANESE_MATERIAL = {
  materialId: "2026FG-JPN-G3",
  series: "FORESTA_GOAL",
  subject: "国語",
  grade: "中3",
  title: "フォレスタゴール国語 中3",
  hasLct: false,
} as const;

export const GOAL_JAPANESE_UNITS: GoalJapaneseUnit[] = [
  {
    "unitId": "2026FG-JPN-G3-UNIT-a876642ce4",
    "unitOrder": 1,
    "unitType": "NORMAL",
    "title": "四字熟語と語句の選定",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-a7d0857188",
    "unitOrder": 2,
    "unitType": "NORMAL",
    "title": "文中の表現を説明する（選択問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-fc3c266ba3",
    "unitOrder": 3,
    "unitType": "NORMAL",
    "title": "文中の表現を説明する（書き抜き）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-b32d124dbc",
    "unitOrder": 4,
    "unitType": "NORMAL",
    "title": "人物の心情を読み取る（選択問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-20d67ff18b",
    "unitOrder": 5,
    "unitType": "NORMAL",
    "title": "人物の心情を読み取る（書き抜き）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-45a254eadd",
    "unitOrder": 6,
    "unitType": "NORMAL",
    "title": "行動や心情の理由（選択問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-1fd1067b23",
    "unitOrder": 7,
    "unitType": "NORMAL",
    "title": "表現の特徴と効果",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-8f64e88ceb",
    "unitOrder": 8,
    "unitType": "NORMAL",
    "title": "物語文と話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-027c1cfd17",
    "unitOrder": 9,
    "unitType": "NORMAL",
    "title": "全体の論旨を読み取る",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-a017f3640d",
    "unitOrder": 10,
    "unitType": "NORMAL",
    "title": "論述の一部を説明する（選択問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-28957a3deb",
    "unitOrder": 11,
    "unitType": "NORMAL",
    "title": "論述の一部を説明する（書き抜き）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-f0ae69b41e",
    "unitOrder": 12,
    "unitType": "NORMAL",
    "title": "主張の根拠を理解する（選択問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-3af6593ed0",
    "unitOrder": 13,
    "unitType": "NORMAL",
    "title": "段落や部分の役割",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-3d31c64683",
    "unitOrder": 14,
    "unitType": "NORMAL",
    "title": "論説文と話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-e3e30e0e9e",
    "unitOrder": 15,
    "unitType": "NORMAL",
    "title": "発表原稿と話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-ede5cb8f10",
    "unitOrder": 16,
    "unitType": "NORMAL",
    "title": "古文　歴史的かなづかい",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-3360ea308f",
    "unitOrder": 17,
    "unitType": "NORMAL",
    "title": "古文　現代語訳",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-5352b60d4e",
    "unitOrder": 18,
    "unitType": "NORMAL",
    "title": "古文　主語を特定する",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-93c59fd08f",
    "unitOrder": 19,
    "unitType": "NORMAL",
    "title": "古文　内容を読み取る",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-131b4587ed",
    "unitOrder": 20,
    "unitType": "NORMAL",
    "title": "古文・漢文",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-a9997268ad",
    "unitOrder": 21,
    "unitType": "NORMAL",
    "title": "古文と話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-e808131029",
    "unitOrder": 22,
    "unitType": "NORMAL",
    "title": "文法　文法の基礎",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-e9423e17fb",
    "unitOrder": 23,
    "unitType": "NORMAL",
    "title": "文法　品詞や活用形の見分け方",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-968a1f978f",
    "unitOrder": 24,
    "unitType": "NORMAL",
    "title": "作文の基礎",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-73654fe497",
    "unitOrder": 25,
    "unitType": "NORMAL",
    "title": "作文",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-d409bafa03",
    "unitOrder": 26,
    "unitType": "NORMAL",
    "title": "人物の心情を読み取る（記述問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-f53a68d608",
    "unitOrder": 27,
    "unitType": "NORMAL",
    "title": "行動や心情の理由（記述問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-a46c38ec75",
    "unitOrder": 28,
    "unitType": "NORMAL",
    "title": "論述の一部を説明する（記述問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-UNIT-4f8a4ca691",
    "unitOrder": 29,
    "unitType": "NORMAL",
    "title": "主張の根拠を理解する（記述問題）",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-f8b40a72e5",
    "unitOrder": 30,
    "unitType": "NORMAL",
    "title": "【論説】段落の働き",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-e7d0240607",
    "unitOrder": 31,
    "unitType": "NORMAL",
    "title": "【物語】心情を問う問題①",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-194507a6f8",
    "unitOrder": 32,
    "unitType": "NORMAL",
    "title": "【古文】選択問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-77756f9726",
    "unitOrder": 33,
    "unitType": "NORMAL",
    "title": "【作文】資料を使った作文",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-46ef41889b",
    "unitOrder": 34,
    "unitType": "NORMAL",
    "title": "【論説】表でまとめる",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-0ea00bb723",
    "unitOrder": 35,
    "unitType": "NORMAL",
    "title": "【物語】心情を問う問題②",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-0d3a7fed6b",
    "unitOrder": 36,
    "unitType": "NORMAL",
    "title": "【議論】資料を使った発表・話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-23c295a396",
    "unitOrder": 37,
    "unitType": "NORMAL",
    "title": "【論説】詩歌の入った問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-adad9c9bee",
    "unitOrder": 38,
    "unitType": "NORMAL",
    "title": "【物語】表現の特色①",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-3436324d10",
    "unitOrder": 39,
    "unitType": "NORMAL",
    "title": "【論説】作文の入った問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-fac6d2476d",
    "unitOrder": 40,
    "unitType": "NORMAL",
    "title": "【古文】古文と話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-7eee1fa106",
    "unitOrder": 41,
    "unitType": "NORMAL",
    "title": "【物語】表現の特色②",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-5eca0a72a1",
    "unitOrder": 42,
    "unitType": "NORMAL",
    "title": "【論説】文章の二か所を使った問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-66fdbdc411",
    "unitOrder": 43,
    "unitType": "NORMAL",
    "title": "【議論】作文の含まれる話し合い",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-c9e08b8640",
    "unitOrder": 44,
    "unitType": "NORMAL",
    "title": "【物語】長めの記述問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-403ae823ac",
    "unitOrder": 45,
    "unitType": "NORMAL",
    "title": "【古文】長めの記述問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-6b15f538a6",
    "unitOrder": 46,
    "unitType": "NORMAL",
    "title": "【論説】長めの記述問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-c6491c36d1",
    "unitOrder": 47,
    "unitType": "NORMAL",
    "title": "【物語】読書ノートの問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-55a54d8001",
    "unitOrder": 48,
    "unitType": "NORMAL",
    "title": "【議論】発表原稿の問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-EXAM-4b01b3b3a2",
    "unitOrder": 49,
    "unitType": "NORMAL",
    "title": "【論説】二つの文章を使った問題",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-HIGH-32196a4de4",
    "unitOrder": 50,
    "unitType": "NORMAL",
    "title": "ハイレベル問題 ①",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-HIGH-e07c88e05c",
    "unitOrder": 51,
    "unitType": "NORMAL",
    "title": "ハイレベル問題 ②",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-HIGH-dbb3c6b68c",
    "unitOrder": 52,
    "unitType": "NORMAL",
    "title": "ハイレベル問題 ③",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-TIME-f41d4dcca7",
    "unitOrder": 53,
    "unitType": "NORMAL",
    "title": "タイムトライアル 第1回",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-TIME-4d4913fe5e",
    "unitOrder": 54,
    "unitType": "NORMAL",
    "title": "タイムトライアル 第2回",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-TIME-e35dec2584",
    "unitOrder": 55,
    "unitType": "NORMAL",
    "title": "タイムトライアル 第3回",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-TIME-68e6fd3b8f",
    "unitOrder": 56,
    "unitType": "NORMAL",
    "title": "タイムトライアル 第4回",
    "hasLct": false
  },
  {
    "unitId": "2026FG-JPN-G3-TIME-edaf50107b",
    "unitOrder": 57,
    "unitType": "NORMAL",
    "title": "タイムトライアル 第5回",
    "hasLct": false
  }
];
