// 模飞生涯 渲染器源码 02-game-data.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
const rankRules = [
  { rank: "学员", minHours: 0, nextHours: 20, label: "距离副驾" },
  { rank: "副驾", minHours: 20, nextHours: 120, label: "距离机长" },
  { rank: "机长", minHours: 120, nextHours: 320, label: "距离教员" },
  { rank: "教员", minHours: 320, nextHours: 500, label: "距离高级教员" },
  { rank: "高级教员", minHours: 500, nextHours: 800, label: "距离检查员" },
  { rank: "检查员", minHours: 800, nextHours: 1200, label: "距离资深检查员" },
  { rank: "资深检查员", minHours: 1200, nextHours: 2000, label: "距离航司导师" },
  { rank: "航司导师", minHours: 2000, nextHours: null, label: "已达顶级" }
];

const LOGO_BASE_URL = "./assets/logos/";
const FUEL_PRICE_PER_KG = 1.35;
const STARTER_HELICOPTER_ID = "cabri-g2";
const companyPilotNames = [
  "林浩", "周岚", "陈默", "赵航", "王宁", "叶晨", "韩雪", "许安", "高远", "沈飞",
  "Alex Carter", "Emma Wilson", "Liam Chen", "Olivia Zhang", "Noah Smith", "Mia Taylor", "Ethan Lee", "Sophia Brown", "Lucas Wang", "Ava Miller"
];
const companyPilotFallbackNames = ["候选飞行员A", "候选飞行员B", "候选飞行员C", "候选飞行员D", "候选飞行员E", "候选飞行员F"];
const companyPilotKinds = [
  "训练机", "特技机", "水陆两栖", "超轻型", "通航单发", "通航双发", "野外短距",
  "单发涡桨", "双发涡桨", "通用涡桨", "轻型喷气", "公务喷气", "干线喷气", "货运喷气",
  "支线客机", "宽体客机", "超大型客机", "超大货运", "军用运输", "重型运输", "高速喷气",
  "直升机", "重型直升机", "旋翼机", "复古飞机", "复古训练"
];
const COMPANY_TASK_OFFER_COUNT = 12;
const COMPANY_STARTUP_FUNDS_MIN = 10_000;
const COMPANY_STARTUP_FUNDS_MAX = 100_000;
const companyTaskCategories = ["客运", "货运", "包机", "医疗", "搜救", "观光"];

const airlines = [
  { id: "aal", code: "AAL", name: "美国航空", region: "北美", salary: 500, rep: 0, type: "综合航司", color: "info" },
  { id: "dal", code: "DAL", name: "达美航空", region: "北美", salary: 510, rep: 0, type: "综合航司", color: "info" },
  { id: "ual", code: "UAL", name: "美国联合航空", region: "北美", salary: 515, rep: 5, type: "综合航司", color: "info" },
  { id: "baw", code: "BAW", name: "英国航空", region: "欧洲", salary: 540, rep: 15, type: "国际航司", color: "good" },
  { id: "afr", code: "AFR", name: "法国航空", region: "欧洲", salary: 535, rep: 15, type: "国际航司", color: "good" },
  { id: "dlh", code: "DLH", name: "汉莎航空", region: "欧洲", salary: 545, rep: 20, type: "国际航司", color: "good" },
  { id: "klm", code: "KLM", name: "荷兰皇家航空", region: "欧洲", salary: 525, rep: 15, type: "国际航司", color: "good" },
  { id: "uae", code: "UAE", name: "阿联酋航空", region: "中东", salary: 690, rep: 55, type: "远程航司", color: "warn" },
  { id: "qtr", code: "QTR", name: "卡塔尔航空", region: "中东", salary: 675, rep: 50, type: "远程航司", color: "warn" },
  { id: "sia", code: "SIA", name: "新加坡航空", region: "东南亚", salary: 660, rep: 45, type: "远程航司", color: "warn" },
  { id: "cpa", code: "CPA", name: "国泰航空", region: "港澳台", salary: 610, rep: 35, type: "国际航司", color: "good" },
  { id: "ana", code: "ANA", name: "全日空", region: "东北亚", salary: 570, rep: 25, type: "综合航司", color: "info" },
  { id: "jal", code: "JAL", name: "日本航空", region: "东北亚", salary: 565, rep: 25, type: "综合航司", color: "info" },
  { id: "cca", code: "CCA", name: "中国国际航空", region: "中国大陆", salary: 560, rep: 25, type: "综合航司", color: "info" },
  { id: "ces", code: "CES", name: "中国东方航空", region: "中国大陆", salary: 545, rep: 20, type: "综合航司", color: "info" },
  { id: "csn", code: "CSN", name: "中国南方航空", region: "中国大陆", salary: 550, rep: 20, type: "综合航司", color: "info" },
  { id: "fdx", code: "FDX", name: "联邦快递航空", region: "全球货运", salary: 620, rep: 30, type: "货运航司", color: "bad" },
  { id: "gti", code: "GTI", name: "阿特拉斯航空", region: "全球货运", salary: 650, rep: 40, type: "货运航司", color: "bad" },
  { id: "qfa", code: "QFA", name: "澳洲航空", region: "大洋洲", salary: 615, rep: 35, type: "国际航司", color: "good" },
  { id: "thy", code: "THY", name: "土耳其航空", region: "欧亚枢纽", salary: 590, rep: 30, type: "国际航司", color: "good" },
  { id: "cxa", code: "CXA", name: "厦门航空", region: "中国大陆", salary: 490, rep: 10, type: "综合航司", color: "info" },
  { id: "chh", code: "CHH", name: "海南航空", region: "中国大陆", salary: 520, rep: 15, type: "综合航司", color: "info" },
  { id: "csc", code: "CSC", name: "山东航空", region: "中国大陆", salary: 455, rep: 5, type: "支线航司", color: "info" },
  { id: "cqh", code: "CQH", name: "春秋航空", region: "中国大陆", salary: 420, rep: 0, type: "低成本航司", color: "info" },
  { id: "dkh", code: "DKH", name: "东海航空", region: "中国大陆", salary: 430, rep: 0, type: "低成本航司", color: "info" },
  { id: "cal", code: "CAL", name: "中华航空", region: "港澳台", salary: 535, rep: 20, type: "国际航司", color: "good" },
  { id: "eva", code: "EVA", name: "长荣航空", region: "港澳台", salary: 540, rep: 20, type: "国际航司", color: "good" },
  { id: "aar", code: "AAR", name: "韩亚航空", region: "东北亚", salary: 520, rep: 18, type: "国际航司", color: "good" },
  { id: "kal", code: "KAL", name: "大韩航空", region: "东北亚", salary: 535, rep: 20, type: "国际航司", color: "good" },
  { id: "mas", code: "MAS", name: "马来西亚航空", region: "东南亚", salary: 495, rep: 12, type: "国际航司", color: "info" },
  { id: "tha", code: "THA", name: "泰国国际航空", region: "东南亚", salary: 500, rep: 12, type: "国际航司", color: "info" },
  { id: "gia", code: "GIA", name: "印度尼西亚鹰航", region: "东南亚", salary: 480, rep: 10, type: "国际航司", color: "info" },
  { id: "vjc", code: "VJC", name: "越捷航空", region: "东南亚", salary: 415, rep: 0, type: "低成本航司", color: "info" },
  { id: "pal", code: "PAL", name: "菲律宾航空", region: "东南亚", salary: 470, rep: 8, type: "国际航司", color: "info" },
  { id: "anz", code: "ANZ", name: "新西兰航空", region: "大洋洲", salary: 560, rep: 25, type: "国际航司", color: "good" },
  { id: "swa", code: "SWA", name: "西南航空", region: "北美", salary: 455, rep: 0, type: "低成本航司", color: "info" },
  { id: "asa", code: "ASA", name: "阿拉斯加航空", region: "北美", salary: 475, rep: 5, type: "区域航司", color: "info" },
  { id: "jbu", code: "JBU", name: "捷蓝航空", region: "北美", salary: 450, rep: 0, type: "低成本航司", color: "info" },
  { id: "swr", code: "SWR", name: "瑞士国际航空", region: "欧洲", salary: 530, rep: 15, type: "国际航司", color: "good" },
  { id: "ibe", code: "IBE", name: "伊比利亚航空", region: "欧洲", salary: 500, rep: 12, type: "国际航司", color: "info" },
  { id: "tap", code: "TAP", name: "葡萄牙航空", region: "欧洲", salary: 490, rep: 10, type: "国际航司", color: "info" },
  { id: "sas", code: "SAS", name: "北欧航空", region: "欧洲", salary: 500, rep: 12, type: "国际航司", color: "info" },
  { id: "fin", code: "FIN", name: "芬兰航空", region: "欧洲", salary: 510, rep: 15, type: "国际航司", color: "good" },
  { id: "etd", code: "ETD", name: "阿提哈德航空", region: "中东", salary: 645, rep: 45, type: "远程航司", color: "warn" },
  { id: "gfa", code: "GFA", name: "海湾航空", region: "中东", salary: 540, rep: 20, type: "国际航司", color: "good" },
  { id: "eth", code: "ETH", name: "埃塞俄比亚航空", region: "非洲", salary: 555, rep: 22, type: "国际航司", color: "good" },
  { id: "saa", code: "SAA", name: "南非航空", region: "非洲", salary: 515, rep: 15, type: "国际航司", color: "info" },
  { id: "amx", code: "AMX", name: "墨西哥航空", region: "拉丁美洲", salary: 500, rep: 12, type: "国际航司", color: "info" }
];

const airportDatabase = [
  ["ZBAA", 40.0801, 116.5846, "北京首都"], ["ZBAD", 39.5098, 116.4105, "北京大兴"],
  ["ZBSJ", 38.2807, 114.6973, "石家庄"], ["ZBTJ", 39.1244, 117.3462, "天津"],
  ["ZSPD", 31.1443, 121.8083, "上海浦东"], ["ZSSS", 31.1979, 121.3363, "上海虹桥"],
  ["ZSNJ", 31.742, 118.862, "南京"], ["ZSHC", 30.2295, 120.4344, "杭州"],
  ["ZGGG", 23.3924, 113.2988, "广州"], ["ZGSZ", 22.6393, 113.8107, "深圳"],
  ["VHHH", 22.308, 113.9185, "香港"], ["VMMC", 22.1496, 113.5915, "澳门"],
  ["ZUUU", 30.5785, 103.9471, "成都双流"], ["ZUTF", 30.319, 104.445, "成都天府"],
  ["ZUCK", 29.7192, 106.6417, "重庆"], ["ZPPP", 25.1019, 102.9292, "昆明"],
  ["ZLXY", 34.4471, 108.7516, "西安"], ["ZHHH", 30.7838, 114.2081, "武汉"],
  ["ZHCC", 34.5197, 113.8409, "郑州"], ["ZSQD", 36.3619, 120.0883, "青岛"],
  ["RJTT", 35.5494, 139.7798, "东京羽田"], ["RJAA", 35.772, 140.3929, "东京成田"],
  ["RJBB", 34.4347, 135.244, "大阪关西"], ["RJCC", 42.7752, 141.6923, "札幌"],
  ["RKSI", 37.4602, 126.4407, "首尔仁川"], ["WSSS", 1.3644, 103.9915, "新加坡"],
  ["VTBS", 13.69, 100.7501, "曼谷"], ["RPLL", 14.5086, 121.0198, "马尼拉"],
  ["EGLL", 51.47, -0.4543, "伦敦希思罗"], ["EGKK", 51.1537, -0.1821, "伦敦盖特威克"],
  ["LFPG", 49.0097, 2.5479, "巴黎戴高乐"], ["EDDF", 50.0379, 8.5622, "法兰克福"],
  ["EHAM", 52.3105, 4.7683, "阿姆斯特丹"], ["EBBR", 50.901, 4.4844, "布鲁塞尔"],
  ["LEMD", 40.4983, -3.5676, "马德里"], ["LIRF", 41.8003, 12.2389, "罗马"],
  ["KLAX", 33.9416, -118.4085, "洛杉矶"], ["KLAS", 36.084, -115.1537, "拉斯维加斯"],
  ["KSFO", 37.6213, -122.379, "旧金山"], ["KSEA", 47.4502, -122.3088, "西雅图"],
  ["KDEN", 39.8561, -104.6737, "丹佛"], ["KASE", 39.2232, -106.8688, "阿斯彭"],
  ["KDFW", 32.8998, -97.0403, "达拉斯"], ["KORD", 41.9742, -87.9073, "芝加哥"],
  ["KJFK", 40.6413, -73.7781, "纽约肯尼迪"], ["KBOS", 42.3656, -71.0096, "波士顿"],
  ["PHNL", 21.3187, -157.9224, "檀香山"], ["PHOG", 20.8986, -156.4305, "茂宜岛"],
  ["YSSY", -33.9399, 151.1753, "悉尼"], ["YMML", -37.6733, 144.8433, "墨尔本"]
].map(([icao, lat, lon, name]) => ({ icao, lat, lon, name }));

let globalAirportDatabase = [...airportDatabase];
let globalAirportIndex = new Map(globalAirportDatabase.map((airport) => [airport.icao, airport]));

const aircraftCatalog = [
  { id: "c152", name: "Cessna 152", kind: "训练机", price: 0, rent: 0, range: 415, pace: "初训", unlockHours: 0, note: "MSFS 经典初级训练机，适合起落航线和基础飞行。" },
  { id: "c152-aerobat", name: "Cessna 152 Aerobat", kind: "训练机", price: 115000, rent: 650, range: 415, pace: "初级特技", unlockHours: 4, note: "强化结构的特技训练型 C152，适合基础特技和精确操纵训练。" },
  { id: "c172", name: "Cessna 172 Skyhawk", kind: "训练机", price: 0, rent: 0, range: 640, pace: "轻型", unlockHours: 0, note: "稳定、节省成本，适合练级和短途通勤。" },
  { id: "c172-classic", name: "Cessna 172 Classic", kind: "训练机", price: 78000, rent: 450, range: 640, pace: "仪表训练", unlockHours: 2, note: "传统仪表版，适合低成本 IFR 训练。" },
  { id: "cap10", name: "Robin CAP 10", kind: "特技机", price: 98000, rent: 680, range: 380, pace: "特技", unlockHours: 4, note: "适合短程训练、特技飞行和挑战任务。" },
  { id: "pitts", name: "Pitts Special S2S", kind: "特技机", price: 140000, rent: 900, range: 298, pace: "特技", unlockHours: 8, note: "高机动特技机，用于高级操纵训练。" },
  { id: "extra330", name: "Extra 330LT", kind: "特技机", price: 230000, rent: 1200, range: 650, pace: "特技", unlockHours: 12, note: "更强的特技性能，适合表演与挑战航段。" },
  { id: "icon-a5", name: "ICON A5", kind: "水陆两栖", price: 245000, rent: 1400, range: 427, pace: "休闲", unlockHours: 6, note: "水陆两栖轻型机，适合湖区和海岸线任务。" },
  { id: "vl3", name: "JMB VL-3", kind: "超轻型", price: 170000, rent: 950, range: 690, pace: "快速轻航", unlockHours: 5, note: "速度快、成本低，适合轻型通勤。" },
  { id: "ctsl", name: "Flight Design CTSL", kind: "超轻型", price: 150000, rent: 850, range: 850, pace: "轻航", unlockHours: 5, note: "适合低成本 VFR 长距离练习。" },
  { id: "dr400", name: "Robin DR400/100 Cadet", kind: "通航单发", price: 165000, rent: 850, range: 550, pace: "通航", unlockHours: 6, note: "欧洲通航训练机，适合短途与手动日志。" },
  { id: "da40-ng", name: "Diamond DA40 NG", kind: "通航单发", price: 430000, rent: 2200, range: 940, pace: "现代训练", unlockHours: 10, note: "玻璃座舱单发，适合仪表训练和区域飞行。" },
  { id: "dv20", name: "Diamond DV20", kind: "训练机", price: 210000, rent: 1200, range: 630, pace: "训练", unlockHours: 8, note: "轻型训练平台，适合初级职业阶段。" },
  { id: "bonanza-g36", name: "Beechcraft Bonanza G36", kind: "通航单发", price: 780000, rent: 3200, range: 920, pace: "私人飞行", unlockHours: 14, note: "适合包机、商务短途和私人航段。" },
  { id: "baron-g58", name: "Beechcraft Baron G58", kind: "通航双发", price: 1350000, rent: 4600, range: 1480, pace: "双发训练", unlockHours: 22, note: "进入双发运行的自然过渡机型。" },
  { id: "da62", name: "Diamond DA62", kind: "通航双发", price: 1420000, rent: 4800, range: 1280, pace: "高效双发", unlockHours: 24, note: "高效双发通航机，适合商务包机和中短程任务。" },
  { id: "xcub", name: "CubCrafters XCub", kind: "野外短距", price: 320000, rent: 1800, range: 695, pace: "STOL", unlockHours: 10, note: "野外短距起降任务的轻型平台。" },
  { id: "nxcub", name: "CubCrafters NX Cub", kind: "野外短距", price: 350000, rent: 1900, range: 800, pace: "STOL", unlockHours: 12, note: "更现代的短距起降机，适合偏远机场。" },
  { id: "zlin-savage", name: "Zlin Savage Cub", kind: "野外短距", price: 190000, rent: 1100, range: 377, pace: "STOL", unlockHours: 8, note: "轻型野外飞行和低速操纵训练。" },
  { id: "cessna-208", name: "Cessna 208B Grand Caravan EX", kind: "单发涡桨", price: 2600000, rent: 7200, range: 1070, pace: "支线/货运", unlockHours: 35, note: "支线客货两用，适合生涯模式早期商业任务。" },
  { id: "kingair-350", name: "Beechcraft King Air 350i", kind: "双发涡桨", price: 6200000, rent: 11800, range: 1806, pace: "商务涡桨", unlockHours: 48, note: "经典双发涡桨，覆盖商务、医疗和支线任务。" },
  { id: "pc6", name: "Pilatus PC-6 Porter", kind: "通用涡桨", price: 1800000, rent: 5200, range: 730, pace: "山地/短距", unlockHours: 28, note: "短距起降能力强，适合山区和特殊任务。" },
  { id: "pc12", name: "Pilatus PC-12 NGX", kind: "通用涡桨", price: 1280000, rent: 4600, range: 1800, pace: "多用途", unlockHours: 24, note: "适合货运、包机和支线运行。" },
  { id: "tbm", name: "Daher TBM 930", kind: "单发涡桨", price: 420000, rent: 3200, range: 1730, pace: "快速通勤", unlockHours: 12, note: "适合短中程通勤与轻货运。" },
  { id: "cirrus-sr22", name: "Cirrus SR22", kind: "通航单发", price: 720000, rent: 3100, range: 1200, pace: "私人飞行", unlockHours: 16, note: "现代私人飞机，适合高端包机和跨区通勤。" },
  { id: "sf50", name: "Cirrus Vision Jet SF50", kind: "轻型喷气", price: 2400000, rent: 7800, range: 1275, pace: "个人喷气", unlockHours: 42, note: "从通航迈向喷气任务的入门机型。" },
  { id: "cj4", name: "Cessna Citation CJ4", kind: "公务喷气", price: 7200000, rent: 13500, range: 2165, pace: "公务机", unlockHours: 60, note: "中短程公务喷气，适合高收益包机。" },
  { id: "longitude", name: "Cessna Citation Longitude", kind: "公务喷气", price: 15500000, rent: 24000, range: 3500, pace: "远程公务", unlockHours: 95, note: "远程公务机，适合高级包机和跨洲任务。" },
  { id: "atr42", name: "ATR 42-600", kind: "支线客机", price: 11800000, rent: 19500, range: 726, pace: "支线", unlockHours: 75, note: "短程支线航班和岛际航线的经济选择。" },
  { id: "atr72", name: "ATR 72-600", kind: "支线客机", price: 17800000, rent: 26000, range: 825, pace: "支线", unlockHours: 85, note: "更大载客量的支线涡桨客机。" },
  { id: "a310", name: "Airbus A310-300", kind: "宽体客机", price: 42000000, rent: 52000, range: 5150, pace: "宽体", unlockHours: 140, note: "经典宽体客机，适合长途客运和复古任务。" },
  { id: "a320", name: "Airbus A320neo", kind: "干线喷气", price: 8400000, rent: 15000, range: 3300, pace: "干线", unlockHours: 80, note: "需要成熟的航线经验，适合高频中短程。" },
  { id: "a321", name: "Airbus A321LR", kind: "干线喷气", price: 12800000, rent: 22000, range: 4000, pace: "长程窄体", unlockHours: 105, note: "长程窄体航线，用于中远程高收益任务。" },
  { id: "a330", name: "Airbus A330-200", kind: "宽体客机", price: 52000000, rent: 62000, range: 7250, pace: "远程宽体", unlockHours: 170, note: "远程国际航班和大型航司任务。" },
  { id: "a400m", name: "Airbus A400M Atlas", kind: "军用运输", price: 65000000, rent: 68000, range: 4700, pace: "重型运输", unlockHours: 180, note: "大型运输任务，适合特殊货运玩法。" },
  { id: "beluga", name: "Airbus Beluga XL", kind: "超大货运", price: 78000000, rent: 82000, range: 2300, pace: "特殊货运", unlockHours: 210, note: "超大件货运任务，高收益但机场受限。" },
  { id: "b38m", name: "Boeing 737 MAX 8", kind: "干线喷气", price: 9800000, rent: 17800, range: 3550, pace: "干线", unlockHours: 90, note: "现代窄体客机，适合主流航司运行。" },
  { id: "b738", name: "Boeing 737-800", kind: "干线喷气", price: 7900000, rent: 14200, range: 2930, pace: "干线", unlockHours: 70, note: "高频干线任务的主力机型，适合插件扩展。" },
  { id: "b738-bdsf", name: "737-800F", kind: "货运喷气", price: 8500000, rent: 15500, range: 2930, pace: "干线货运", unlockHours: 75, note: "Boeing 737-800BDSF 货机，适合中短程货运航线。" },
  { id: "b738-bcf", name: "737-800F", kind: "货运喷气", price: 8500000, rent: 15500, range: 2930, pace: "干线货运", unlockHours: 75, note: "Boeing 737-800BCF 货机，适合中短程货运航线。" },
  { id: "b748", name: "Boeing 747-8 Intercontinental", kind: "超大型客机", price: 88000000, rent: 92000, range: 8000, pace: "洲际", unlockHours: 220, note: "最高等级远程客运和旗舰航线。" },
  { id: "b787", name: "Boeing 787-10 Dreamliner", kind: "宽体客机", price: 76000000, rent: 85000, range: 6430, pace: "远程宽体", unlockHours: 200, note: "现代远程宽体客机，适合洲际航线。" },
  { id: "c17", name: "Boeing C-17 Globemaster III", kind: "重型运输", price: 95000000, rent: 99000, range: 4482, pace: "战略运输", unlockHours: 240, note: "重型运输职业线的终局机型。" },
  { id: "fa18", name: "F/A-18E Super Hornet", kind: "高速喷气", price: 58000000, rent: 62000, range: 1275, pace: "高速挑战", unlockHours: 160, note: "用于高速挑战和特殊飞行活动，不参与普通客运。" },
  { id: "h125", name: "Airbus H125", kind: "直升机", price: 3600000, rent: 9800, range: 340, pace: "直升机", unlockHours: 55, note: "适合观光、山区、救援和短距任务。" },
  { id: "h225", name: "Airbus H225", kind: "重型直升机", price: 24000000, rent: 38000, range: 452, pace: "搜救/运输", unlockHours: 120, note: "重型直升机，适合搜救、海上平台和运输任务。" },
  { id: "bell-407", name: "Bell Model 407", kind: "直升机", price: 3200000, rent: 8500, range: 324, pace: "观光/通勤", unlockHours: 35, note: "灵活的轻型涡轴直升机，适合观光、包机和近场救援。" },
  { id: "s64f", name: "Erickson S-64F Skycrane", kind: "重型直升机", price: 36000000, rent: 48000, range: 200, pace: "重型吊运", unlockHours: 145, note: "专用空中吊车，适合消防、工程吊运和特殊货运。" },
  { id: "ch47d", name: "Boeing CH-47D Chinook", kind: "重型直升机", price: 38000000, rent: 52000, range: 400, pace: "重型运输", unlockHours: 150, note: "双旋翼重型运输直升机，适合大型货运和救援投送。" },
  { id: "ec135-t1", name: "Eurocopter EC-135 T1", kind: "直升机", price: 6200000, rent: 14000, range: 342, pace: "医疗/公务", unlockHours: 60, note: "双发轻型直升机，适合医疗转运、公务和城市救援。" },
  { id: "r66", name: "Robinson R66 Turbine", kind: "直升机", price: 1200000, rent: 4800, range: 350, pace: "轻型通勤", unlockHours: 25, note: "经济型涡轴直升机，适合训练、观光和短途包机。" },
  { id: "cabri-g2", name: "Guimbal Cabri G2", kind: "直升机", price: 0, rent: 0, range: 380, pace: "直升机训练", unlockHours: 0, note: "初始配发的轻型活塞直升机，适合旋翼机训练和低成本观光。" },
  { id: "uh1h", name: "Bell UH-1H Huey", kind: "直升机", price: 3000000, rent: 9000, range: 275, pace: "通用运输", unlockHours: 45, note: "经典通用直升机，适合货物投送、搜救和特殊任务。" },
  // MSFS 2024 catalog models. Existing records above keep their legacy IDs
  // so saved fleets and accepted missions remain compatible.
  { id: "b736", name: "Boeing 737-600", kind: "干线喷气", price: 16000000, rent: 23000, range: 3000, pace: "干线", unlockHours: 95, note: "737 家族短机身型号，适合中短程干线运行。" },
  { id: "b739", name: "Boeing 737-900ER", kind: "干线喷气", price: 18000000, rent: 25000, range: 3300, pace: "干线", unlockHours: 105, note: "高容量窄体客机，适合繁忙干线航班。" },
  { id: "b752", name: "Boeing 757-200", kind: "干线喷气", price: 27000000, rent: 38000, range: 3900, pace: "中程干线", unlockHours: 120, note: "高性能中程客机，适合跨区域和高原航线。" },
  { id: "b762", name: "Boeing 767-200ER", kind: "宽体客机", price: 38000000, rent: 52000, range: 6800, pace: "宽体", unlockHours: 140, note: "经典双发宽体客机，适合中远程客运。" },
  { id: "b763", name: "Boeing 767-300ER", kind: "宽体客机", price: 45000000, rent: 60000, range: 7200, pace: "宽体", unlockHours: 155, note: "加长型 767，适合中远程客运和货运。" },
  { id: "b772", name: "Boeing 777-200ER", kind: "宽体客机", price: 75000000, rent: 88000, range: 9700, pace: "远程宽体", unlockHours: 210, note: "远程双发宽体客机，适合洲际航线。" },
  { id: "b77l", name: "Boeing 777-200LR", kind: "宽体客机", price: 82000000, rent: 95000, range: 12400, pace: "超远程", unlockHours: 240, note: "超远程 777，适合跨洲和极长航段。" },
  { id: "b77w", name: "Boeing 777-300ER", kind: "宽体客机", price: 88000000, rent: 98000, range: 9600, pace: "远程宽体", unlockHours: 220, note: "高载客量远程宽体，适合主干国际航线。" },
  { id: "b788", name: "Boeing 787-8 Dreamliner", kind: "宽体客机", price: 68000000, rent: 78000, range: 7355, pace: "远程宽体", unlockHours: 190, note: "高效远程宽体客机，适合跨洲和中远程任务。" },
  { id: "b789", name: "Boeing 787-9 Dreamliner", kind: "宽体客机", price: 72000000, rent: 82000, range: 7635, pace: "远程宽体", unlockHours: 205, note: "加长型 Dreamliner，兼顾航程和载客量。" },
  { id: "a220-100", name: "Airbus A220-100", kind: "干线喷气", price: 22000000, rent: 32000, range: 3450, pace: "支线干线", unlockHours: 100, note: "高效小型窄体客机，适合区域干线。" },
  { id: "a220-300", name: "Airbus A220-300", kind: "干线喷气", price: 25000000, rent: 36000, range: 3450, pace: "支线干线", unlockHours: 105, note: "A220 加长型，适合高频区域客运。" },
  { id: "a300-600", name: "Airbus A300-600", kind: "宽体客机", price: 35000000, rent: 48000, range: 7500, pace: "宽体", unlockHours: 145, note: "经典双发宽体，适合客运和货运航线。" },
  { id: "a319", name: "Airbus A319", kind: "干线喷气", price: 18000000, rent: 26000, range: 3700, pace: "干线", unlockHours: 100, note: "A320 家族短机身型号，适合中短程航线。" },
  { id: "a319neo", name: "Airbus A319neo", kind: "干线喷气", price: 20000000, rent: 29000, range: 3900, pace: "干线", unlockHours: 105, note: "新一代高效窄体客机，适合区域干线。" },
  { id: "a320-ceo", name: "Airbus A320", kind: "干线喷气", price: 22000000, rent: 31000, range: 3300, pace: "干线", unlockHours: 90, note: "经典 A320，适合高频中短程航线。" },
  { id: "a321-ceo", name: "Airbus A321", kind: "干线喷气", price: 25000000, rent: 35000, range: 4000, pace: "长程窄体", unlockHours: 105, note: "高容量窄体客机，适合繁忙中程航线。" },
  { id: "a330-300", name: "Airbus A330-300", kind: "宽体客机", price: 58000000, rent: 68000, range: 6100, pace: "远程宽体", unlockHours: 180, note: "高载客量宽体客机，适合国际航线。" },
  { id: "a340-300", name: "Airbus A340-300", kind: "宽体客机", price: 62000000, rent: 74000, range: 13700, pace: "远程宽体", unlockHours: 210, note: "四发远程宽体，适合经典洲际航线。" },
  { id: "a350-900", name: "Airbus A350-900", kind: "宽体客机", price: 90000000, rent: 100000, range: 15000, pace: "超远程", unlockHours: 260, note: "新一代远程宽体客机，适合高等级洲际任务。" },
  { id: "a350-1000", name: "Airbus A350-1000", kind: "宽体客机", price: 105000000, rent: 115000, range: 16100, pace: "超远程", unlockHours: 280, note: "A350 加长型，适合高载客量远程航线。" },
  { id: "a380-800", name: "Airbus A380-800", kind: "宽体客机", price: 130000000, rent: 145000, range: 15200, pace: "超大型", unlockHours: 320, note: "超大型远程客机，适合旗舰洲际航线。" },
  { id: "crj-200", name: "Bombardier CRJ-200", kind: "支线客机", price: 7000000, rent: 10000, range: 1500, pace: "支线", unlockHours: 55, note: "小型支线喷气机，适合短程区域航线。" },
  { id: "crj-700", name: "Bombardier CRJ-700", kind: "支线客机", price: 10000000, rent: 14000, range: 1800, pace: "支线", unlockHours: 60, note: "中型支线客机，适合区域通勤航班。" },
  { id: "crj-900", name: "Bombardier CRJ-900", kind: "支线客机", price: 14000000, rent: 18000, range: 1800, pace: "支线", unlockHours: 65, note: "加长型支线客机，适合高频区域航线。" },
  { id: "crj-1000", name: "Bombardier CRJ-1000", kind: "支线客机", price: 18000000, rent: 23000, range: 2800, pace: "支线", unlockHours: 75, note: "CRJ 家族最大型号，适合中程支线。" },
  { id: "e170", name: "Embraer E170", kind: "支线客机", price: 12000000, rent: 18000, range: 2150, pace: "支线", unlockHours: 70, note: "灵活的小型支线喷气机，适合区域通勤。" },
  { id: "e175", name: "Embraer E175", kind: "支线客机", price: 16000000, rent: 22000, range: 4000, pace: "支线", unlockHours: 75, note: "成熟的支线客机，适合高频短中程航线。" },
  { id: "e190", name: "Embraer E190", kind: "支线客机", price: 22000000, rent: 30000, range: 4500, pace: "支线干线", unlockHours: 85, note: "大容量支线客机，适合区域干线运行。" },
  { id: "e195", name: "Embraer E195", kind: "支线客机", price: 25000000, rent: 34000, range: 4800, pace: "支线干线", unlockHours: 90, note: "E-Jet 加长型，适合中程高频客运。" },
  { id: "e190-e2", name: "Embraer E190-E2", kind: "支线客机", price: 28000000, rent: 38000, range: 5200, pace: "新一代支线", unlockHours: 100, note: "新一代高效支线客机，适合中程航线。" },
  { id: "e195-e2", name: "Embraer E195-E2", kind: "支线客机", price: 32000000, rent: 43000, range: 5500, pace: "新一代支线", unlockHours: 110, note: "E2 家族大容量型号，适合区域干线。" },
  { id: "md-11", name: "McDonnell Douglas MD-11", kind: "宽体客机", price: 60000000, rent: 78000, range: 7300, pace: "远程宽体", unlockHours: 190, note: "经典三发宽体，适合远程客运和货运。" },
  { id: "md-82", name: "McDonnell Douglas MD-82", kind: "干线喷气", price: 10000000, rent: 16000, range: 2050, pace: "中程干线", unlockHours: 65, note: "经典中程窄体客机，适合复古航线任务。" },
  { id: "bae-146-100", name: "BAe 146-100", kind: "支线客机", price: 8000000, rent: 12000, range: 1500, pace: "支线", unlockHours: 55, note: "短距起降支线客机，适合区域机场。" },
  { id: "bae-146-200", name: "BAe 146-200", kind: "支线客机", price: 10000000, rent: 14000, range: 1800, pace: "支线", unlockHours: 60, note: "加长型 146，适合短中程支线运行。" },
  { id: "bae-146-300", name: "BAe 146-300", kind: "支线客机", price: 12000000, rent: 17000, range: 1900, pace: "支线", unlockHours: 65, note: "146 家族大容量型号，适合区域客运。" },
  { id: "avro-rj85", name: "Avro RJ85", kind: "支线客机", price: 11000000, rent: 16000, range: 1650, pace: "支线", unlockHours: 60, note: "安静的四发支线客机，适合短程区域航线。" },
  { id: "fokker-f28", name: "Fokker F28 Fellowship", kind: "支线客机", price: 8000000, rent: 12000, range: 1700, pace: "复古支线", unlockHours: 55, note: "经典早期支线喷气机，适合复古航线任务。" },
  { id: "pitts-s1s", name: "Aviat Pitts Special S-1S", kind: "特技机", price: 120000, rent: 800, range: 290, pace: "单座特技", unlockHours: 6, note: "灵敏的单座特技机，适合高级操纵和表演飞行。" },
  { id: "kingair-c90", name: "Beechcraft King Air C90 GTX", kind: "双发涡桨", price: 3800000, rent: 8500, range: 1260, pace: "商务涡桨", unlockHours: 40, note: "紧凑型双发商务涡桨，适合客运、包机和医疗任务。" },
  { id: "blackbird-310r", name: "Blackbird Simulations 310R", kind: "通航双发", price: 850000, rent: 3000, range: 900, pace: "经典双发", unlockHours: 18, note: "经典轻型双发飞机，适合区域包机和仪表飞行。" },
  { id: "cessna-185", name: "Cessna 185 Skywagon", kind: "野外短距", price: 480000, rent: 2300, range: 620, pace: "野外通航", unlockHours: 14, note: "高性能尾轮通航机，适合偏远机场和野外运输。" },
  { id: "cessna-188", name: "Cessna 188 AGtruck", kind: "通航单发", price: 320000, rent: 1800, range: 430, pace: "农业作业", unlockHours: 12, note: "专用农业作业飞机，也可承担低空巡查和短途任务。" },
  { id: "cessna-404", name: "Cessna 404 Titan", kind: "通航双发", price: 1900000, rent: 5600, range: 1700, pace: "客货运输", unlockHours: 32, note: "双发客货运输机，适合区域物流和多人包机。" },
  { id: "cessna-c400", name: "Cessna C400 Corvalis TT", kind: "通航单发", price: 820000, rent: 3400, range: 1250, pace: "高性能通航", unlockHours: 20, note: "高速增压单发飞机，适合商务通勤和长距离包机。" },
  { id: "cessna-c408", name: "Cessna C408 SkyCourier", kind: "双发涡桨", price: 8200000, rent: 14500, range: 920, pace: "支线/货运", unlockHours: 58, note: "现代双发支线涡桨，适合客运和高频货运任务。" },
  { id: "curtiss-jn4", name: "Curtiss JN-4 Jenny", kind: "复古飞机", price: 180000, rent: 1200, range: 155, pace: "复古训练", unlockHours: 8, note: "早期双翼训练机，适合历史飞行和低速观光。" },
  { id: "dhc6-300", name: "De Havilland DHC-6-300 Twin Otter", kind: "双发涡桨", price: 6800000, rent: 12500, range: 775, pace: "短距支线", unlockHours: 52, note: "可靠的双发短距运输机，适合岛际、货运和偏远机场。" },
  { id: "magni-m24", name: "Magni Gyro M24", kind: "旋翼机", price: 180000, rent: 1100, range: 430, pace: "自转旋翼", unlockHours: 10, note: "轻型封闭式旋翼机，适合低空观光和巡查任务。" },
  { id: "draco-x", name: "Atey Aviation Draco X", kind: "野外短距", price: 1500000, rent: 5200, range: 620, pace: "极限 STOL", unlockHours: 30, note: "高性能涡桨短距飞机，适合山地和极端野外起降。" },
  { id: "pc24", name: "Pilatus PC-24", kind: "公务喷气", price: 11500000, rent: 21000, range: 2000, pace: "多用途公务", unlockHours: 82, note: "可在短跑道运行的公务喷气机，适合高级包机和商务航段。" },
  { id: "ryan-nyp", name: "Ryan NYP Spirit of St. Louis", kind: "复古飞机", price: 650000, rent: 2800, range: 3590, pace: "历史远航", unlockHours: 25, note: "经典远航飞机，适合历史挑战和复古长途任务。" },
  { id: "saab-340", name: "Saab 340", kind: "支线客机", price: 9000000, rent: 15000, range: 935, pace: "支线涡桨", unlockHours: 62, note: "成熟的双发支线客机，适合区域客运和短程航线。" }
];

// Type ratings are kept per catalog model so similarly named variants still
// require their own affordable check-out license.
const aircraftLicenseCatalog = aircraftCatalog.map((aircraft) => ({
  id: aircraft.id,
  name: aircraft.name,
  kind: aircraft.kind,
  cost: Math.min(12000, 1200 + Math.round((Number(aircraft.unlockHours) || 0) * 35 / 100) * 100)
}));

const aircraftIdentityRules = {
  c152: ["C152", "CESSNA152", "152ASOBO"],
  "c152-aerobat": ["CESSNA152AEROBAT", "C152AEROBAT", "152AEROBAT", "AEROBAT"],
  c172: ["C172", "C172SP", "CESSNA172", "SKYHAWK"],
  "c172-classic": ["C172", "C172SP", "CESSNA172", "SKYHAWK"],
  cap10: ["CAP10", "ROBINCAPI0"],
  pitts: ["AVIATPITTSSPECIALS2S", "PITTSS2S", "S2S"],
  extra330: ["EXTRA330", "EXTRA330LT", "EA30"],
  "icon-a5": ["ICONA5", "ICA5"],
  vl3: ["JMBVL3", "VL3"],
  ctsl: ["FLIGHTDESIGNCTSL", "CTSL", "CTSW"],
  dr400: ["ROBINDR400", "DR400", "DR40"],
  "da40-ng": ["DIAMONDDA40", "DA40NG", "DA40"],
  dv20: ["DIAMONDDV20", "DV20"],
  "bonanza-g36": ["BONANZAG36", "BEECHCRAFTBONANZAG36", "BEECHCRAFTG36", "G36ASOBO", "BE36"],
  "baron-g58": ["BARONG58", "BEECHCRAFTBARONG58", "BEECHCRAFTG58", "G58ASOBO", "BE58"],
  da62: ["DIAMONDDA62", "DA62"],
  xcub: ["CUBCRAFTERSXCUB", "XCUB", "CC19"],
  nxcub: ["CUBCRAFTERSNXCUB", "NXCUB"],
  "zlin-savage": ["ZLINSAVAGECUB", "SAVAGECUB"],
  "cessna-208": ["CESSNA208B", "CESSNA208BGRANDCARAVANEX", "208BGRANDCARAVANEX", "C208B", "GRANDCARAVAN", "CARAVANEX"],
  "kingair-350": ["BEECHCRAFTKINGAIR350I", "KINGAIR350I", "KINGAIR350", "350IASOBO", "B350"],
  pc6: ["PILATUSPC6", "PC6PORTER", "PC6T"],
  pc12: ["PILATUSPC12", "PC12NGX", "PC12"],
  tbm: ["DAHERTBM930", "TBM930", "TBM9"],
  "cirrus-sr22": ["CIRRUSSR22", "SR22"],
  sf50: ["VISIONJETSF50", "CIRRUSSF50", "CIRRUSVISIONJETG2", "VISIONJETG2", "SF50"],
  cj4: ["CITATIONCJ4", "CESSNACJ4", "C25C"],
  longitude: ["CITATIONLONGITUDE", "CESSNALONGITUDE", "C700"],
  atr42: ["ATR42600", "AT46"],
  atr72: ["ATR72600", "AT76"],
  a310: ["AIRBUSA310", "INIBUILDSA310", "A310"],
  a320: ["AIRBUSA320NEO", "A320NEO", "FLYBYWIREA32NX", "A32NX", "A20N"],
  a321: ["AIRBUSA321LR", "A321LR", "A321NEO", "A21N"],
  a330: ["AIRBUSA330200", "A330200", "A332"],
  a400m: ["AIRBUSA400M", "A400MATLAS", "A400"],
  beluga: ["AIRBUSBELUGAXL", "BELUGAXL", "A337", "BLCF"],
  b38m: ["BOEING737MAX8", "B737MAX8", "737MAX8", "B38M"],
  b738: ["BOEING737800", "B737800", "PMDG737800", "IFLY737800", "737800", "B738"],
  "b738-bdsf": ["BOEING737800BDSF", "B737800BDSF", "PMDG737800BDSF", "737800BDSF", "B738BDSF"],
  "b738-bcf": ["BOEING737800BCF", "B737800BCF", "PMDG737800BCF", "737800BCF", "B738BCF"],
  b748: ["BOEING7478", "BOEING7478I", "7478INTERCONTINENTAL", "B748"],
  b787: ["BOEING78710", "78710DREAMLINER", "ASOBO78710", "B78X"],
  c17: ["BOEINGC17", "C17GLOBEMASTER", "GLOBEMASTERIII"],
  fa18: ["FA18E", "F18E", "F18H", "SUPERHORNET"],
  h125: ["AIRBUSH125", "H125", "AS50"],
  h225: ["AIRBUSH225", "H225", "EC25"],
  "bell-407": ["BELLModel407", "BELL407", "INIBUILDSBELL407", "ASOBOBELL407", "B407"],
  s64f: ["ERICKSONS64F", "S64FSKYCRANE", "S64F", "SKYCRANE"],
  ch47d: ["BOEINGCH47D", "CH47DCHINOOK", "CH47D", "CHINOOK"],
  "ec135-t1": ["EUROCOPTEREC135T1", "EC135T1", "EC135", "EC35"],
  r66: ["ROBINSONR66TURBINE", "ROBINSONR66", "CARENADOR66", "R66"],
  "cabri-g2": ["GUIMBALCABRIG2", "CABRIG2", "ASOBOCABRIG2"],
  uh1h: ["BELLUH1H", "UH1HHUEY", "TAOGUH1H", "UH1H", "HUEY"],
  b736: ["BOEING737600", "B737600", "737600", "B736"],
  b739: ["BOEING737900ER", "B737900ER", "737900ER", "B739"],
  b752: ["BOEING757200", "B757200", "757200", "B752"],
  b762: ["BOEING767200ER", "B767200ER", "767200ER", "B762"],
  b763: ["BOEING767300ER", "B767300ER", "767300ER", "B763"],
  b772: ["BOEING777200ER", "B777200ER", "777200ER", "B772"],
  b77l: ["BOEING777200LR", "B777200LR", "777200LR", "B77L"],
  b77w: ["BOEING777300ER", "B777300ER", "777300ER", "B77W"],
  b788: ["BOEING7878", "7878DREAMLINER", "7878", "B788"],
  b789: ["BOEING7879", "7879DREAMLINER", "7879", "B789"],
  "a220-100": ["AIRBUSA220100", "A220100", "BCS1"],
  "a220-300": ["AIRBUSA220300", "A220300", "BCS3"],
  "a300-600": ["AIRBUSA300600", "A300600", "A306"],
  a319: ["AIRBUSA319", "FENIXA319", "A319"],
  a319neo: ["AIRBUSA319NEO", "A319NEO", "A19N"],
  "a320-ceo": ["AIRBUSA320", "FENIXA320", "A320CEO", "A320"],
  "a321-ceo": ["AIRBUSA321", "FENIXA321", "A321CEO", "A321"],
  "a330-300": ["AIRBUSA330300", "A330300", "A333"],
  "a340-300": ["AIRBUSA340300", "A340300", "A343"],
  "a350-900": ["AIRBUSA350900", "A350900ULR", "A350900", "A359"],
  "a350-1000": ["AIRBUSA3501000", "A3501000ETIHADCABIN", "A3501000", "A35K"],
  "a380-800": ["FLYBYWIREA380X", "AIRBUSA380X", "A380842", "AIRBUSA380800", "A380800", "A388"],
  "crj-200": ["BOMBARDIERCRJ200", "CRJ200", "CRJ2"],
  "crj-700": ["BOMBARDIERCRJ700", "CRJ700", "CRJ7"],
  "crj-900": ["BOMBARDIERCRJ900", "CRJ900", "CRJ9"],
  "crj-1000": ["BOMBARDIERCRJ1000", "CRJ1000", "CRJX"],
  e170: ["EMBRAERE170", "E170"],
  e175: ["EMBRAERE175", "E175", "E75L"],
  e190: ["EMBRAERE190", "E190"],
  e195: ["EMBRAERE195", "E195"],
  "e190-e2": ["EMBRAERE190E2", "E190E2", "E290"],
  "e195-e2": ["EMBRAERE195E2", "E195E2", "E295"],
  "md-11": ["MCDONNELLDouglasMD11", "MCDONNELDOUGLASMD11", "MD11"],
  "md-82": ["MCDONNELLDouglasMD82", "MCDONNELDOUGLASMD82", "MD82"],
  "bae-146-100": ["BAE146100", "BAE146", "146100", "B461"],
  "bae-146-200": ["BAE146200", "146200", "B462"],
  "bae-146-300": ["BAE146300", "146300", "B463"],
  "avro-rj85": ["AVRORJ85", "RJ85"],
  "fokker-f28": ["FOKKERF28", "F28FELLOWSHIP", "F28"],
  "pitts-s1s": ["AVIATPITTSSPECIALS1S", "PITTSS1S", "S1S"],
  "kingair-c90": ["BEECHCRAFTKINGAIRC90GTX", "KINGAIRC90GTX", "KINGAIRC90", "C90GTX", "BE9L"],
  "blackbird-310r": ["BLACKBIRDSIMULATIONS310R", "CESSNA310R", "BLACKBIRD310R", "C310R", "C310"],
  "cessna-185": ["CESSNA185SKYWAGON", "CESSNA185", "C185SKYWAGON", "C185"],
  "cessna-188": ["CESSNA188AGTRUCK", "CESSNA188", "AGTRUCK", "C188"],
  "cessna-404": ["CESSNA404TITAN", "CESSNA404", "C404TITAN", "C404"],
  "cessna-c400": ["CESSNAC400CORVALISTT", "C400CORVALISTT", "CORVALISTT", "C400"],
  "cessna-c408": ["CESSNAC408SKYCOURIER", "C408SKYCOURIER", "SKYCOURIER", "C408"],
  "curtiss-jn4": ["CURTISSJN4JENNY", "CURTISSJN4", "JN4JENNY", "JN4"],
  "dhc6-300": ["DEHAVILLANDDHC6300", "DHC6300", "TWINOTTER300", "DHC6"],
  "magni-m24": ["MAGNIGYROM24", "MAGNIM24", "GYROM24", "M24ORION"],
  "draco-x": ["ATEYAVIATIONDRACOX", "GOTFRIENDSDRACOX", "DRACOX"],
  pc24: ["PILATUSPC24", "PC24", "PC24JET"],
  "ryan-nyp": ["RYANNYPSPIRITOFSTLOUIS", "RYANNYP", "SPIRITOFSTLOUIS", "NYP"],
  "saab-340": ["SAAB340", "SAAB340B", "SF34"]
};

// The catalog's `kind` is an operational subtype (for example, wide-body or
// turboprop) and is intentionally kept for mission/license rules.  The UI
// needs a stable manufacturer grouping instead, so derive it from the catalog
// identity/name without changing saved-fleet records.
function aircraftManufacturerFamily(aircraft) {
  const id = String(aircraft?.catalogId || aircraft?.id || "").trim().toLowerCase();
  const text = `${aircraft?.manufacturer || ""} ${aircraft?.name || ""} ${aircraft?.title || ""} ${aircraft?.aircraftTitle || ""}`.toUpperCase();
  if (text.includes("AIRBUS") || /^(a|beluga)/.test(id)) return "空客";
  if (text.includes("BOEING") || /^(b\d|b738-|ch47d$)/.test(id)) return "波音";
  return "其他制造商";
}

const passengerMissionKinds = new Set([
  "训练机", "通航单发", "通航双发", "单发涡桨", "双发涡桨", "支线客机",
  "支线干线", "干线喷气", "长程窄体", "宽体客机", "超大型客机",
  "公务喷气", "轻型喷气", "远程公务", "直升机", "重型直升机"
]);

// These multi-purpose models do not share a passenger-specific `kind`, but
// their real-world configuration supports passenger service.
const passengerMissionAircraftIds = new Set([
  "pc12", "cessna-c408", "dhc6-300", "saab-340", "kingair-c90", "pc6",
  "h125", "h225", "bell-407", "ec135-t1", "r66", "cabri-g2", "uh1h", "ch47d"
]);

function hasMissionCapability(category, aircraft) {
  if (!aircraft) return false;
  const id = String(aircraft.catalogId || aircraft.id || "").trim().toLowerCase();
  const kind = String(aircraft.kind || "");
  if (category === "客运") {
    // Cargo-only and combat/specialized transports must never enter the
    // passenger pool, even when their manufacturer is Airbus or Boeing.
    if (["货运喷气", "超大货运", "军用运输", "重型运输", "高速喷气"].includes(kind)) return false;
    return passengerMissionKinds.has(kind) || passengerMissionAircraftIds.has(id);
  }
  return false;
}

const missionPolicies = {
  客运: { min: 70, max: 1800, phases: ["日间", "傍晚"], kinds: ["训练机", "通航单发", "通航双发", "单发涡桨", "双发涡桨", "支线客机", "支线干线", "干线喷气", "长程窄体", "宽体客机", "超大型客机", "公务喷气", "轻型喷气", "远程公务", "直升机", "重型直升机"], label: "客运" },
  货运: { min: 45, max: 2200, phases: ["傍晚", "夜间"], kinds: ["通航单发", "单发涡桨", "通用涡桨", "双发涡桨", "支线客机", "干线喷气", "货运喷气", "重型运输", "超大货运", "直升机", "重型直升机"], label: "货运" },
  包机: { min: 35, max: 1200, phases: ["日间", "傍晚"], kinds: ["训练机", "通航单发", "通航双发", "单发涡桨", "双发涡桨", "公务喷气", "轻型喷气", "远程公务", "直升机", "旋翼机", "复古飞机"], label: "包机" },
  医疗: { min: 30, max: 550, phases: ["全天候"], kinds: ["通航单发", "单发涡桨", "通用涡桨", "双发涡桨", "直升机", "重型直升机"], label: "医疗转运" },
  搜救: { min: 8, max: 55, phases: ["日间", "傍晚"], kinds: ["野外短距", "通用涡桨", "直升机", "重型直升机", "水陆两栖"], label: "近场搜救" },
  海上救援: { min: 15, max: 75, phases: ["日间", "傍晚"], kinds: ["水陆两栖", "直升机", "重型直升机"], label: "近海救援" },
  事故调查: { min: 8, max: 60, phases: ["日间"], kinds: ["训练机", "通航单发", "野外短距", "通用涡桨", "直升机", "重型直升机", "旋翼机", "复古飞机"], label: "现场调查" }
};

const missionPools = {
  客运: ["区域通勤", "国内短途", "干线往返", "夜航客运"],
  货运: ["轻货转运", "区域物流", "夜间快件", "高价值货物"],
  包机: ["商务包机", "观光包机", "VIP接送", "临时调机"],
  医疗: ["紧急转运", "器官转运", "医疗包机", "山区救援"],
  搜救: ["坠机现场搜救", "事故现场支援", "失联飞机定位", "山地伤员撤离"],
  海上救援: ["海上人员搜救", "落水人员救援", "沉船现场救援", "遇险船只定位"],
  事故调查: ["航空事故调查", "道路事故支援", "残骸定位", "现场勘察"]
};

const emergencyMissionCategories = ["医疗", "搜救", "海上救援", "事故调查"];
const MISSION_OFFER_TARGET_COUNT = 50;
const MISSION_EMERGENCY_TARGET_COUNT = 2;
const MISSION_OFFER_LIFETIME_MS = 3 * 60_000;
const MISSION_REFRESH_INTERVAL_MS = 45_000;

const flightCareerMissionScenes = {
  坠机现场搜救: { icon: "siren", objectTitle: "FCMscene1", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMscene1nla1a", seconds: 2.5, radiusNm: 4, objective: "抵达事故现场，低空盘旋并确认幸存者位置" },
  事故现场支援: { icon: "ambulance", objectTitle: "FCMscene2", terrain: "land", requiresLanding: true, arrivalMode: "landing", smokeTitle: "FCMsmoke1", clip: "FCMscene2nla1a", seconds: 2.5, radiusNm: 3, objective: "运送救援人员并在现场附近安全着陆" },
  失联飞机定位: { icon: "scan-search", objectTitle: "FCMwreckedplane1", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "静态场景", seconds: 0, radiusNm: 6, objective: "沿搜索航线定位失联飞机残骸" },
  山地伤员撤离: { icon: "heart-pulse", objectTitle: "FCMscene2", terrain: "land", requiresLanding: true, arrivalMode: "landing", smokeTitle: "FCMsmoke1", clip: "FCMscene2nla1a", seconds: 2.5, radiusNm: 3, objective: "在复杂地形安全降落，完成伤员接载后再次起飞撤离" },
  海上人员搜救: { icon: "life-buoy", objectTitle: "FCMsea1", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsea1nla1a / 1b / 1c", seconds: 40, radiusNm: 5, objective: "搜索海面人员，保持目视并完成救援" },
  落水人员救援: { icon: "waves", objectTitle: "FCMsea2", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsea2nla1a", seconds: 4.17, radiusNm: 3, objective: "定位落水人员并在低速稳定状态下施救" },
  沉船现场救援: { icon: "ship-wheel", objectTitle: "FCMsinkingboat2", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsinkingboat2nla1a", seconds: 6.67, radiusNm: 5, objective: "抵达沉船位置，确认遇险人员并呼叫支援" },
  遇险船只定位: { icon: "radar", objectTitle: "FCMsinkingboat4", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude", smokeTitle: "FCMsmoke1", clip: "FCMsinkingboat4nla1a", seconds: 8.33, radiusNm: 7, objective: "根据最后坐标搜索并识别遇险船只" },
  航空事故调查: { icon: "search", objectTitle: "FCMcrashedplane6", terrain: "land", requiresLanding: true, arrivalMode: "landing", clip: "静态场景", seconds: 0, radiusNm: 3, objective: "运输调查组，在事故现场附近安全着陆并完成勘察" },
  道路事故支援: { icon: "car", objectTitle: "FCMcrashedcar2", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "静态场景", seconds: 0, radiusNm: 2, objective: "定位道路事故现场并引导地面救援" },
  残骸定位: { icon: "locate-fixed", objectTitle: "FCMwreckedplane4", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "静态场景", seconds: 0, radiusNm: 5, objective: "搜索指定区域并记录残骸位置" },
  现场勘察: { icon: "search-check", objectTitle: "FCMscene1", terrain: "land", requiresLanding: false, arrivalMode: "low-altitude", clip: "FCMscene1nla1a", seconds: 2.5, radiusNm: 3, objective: "完成现场航拍、位置标记和调查组投送" }
};

const missionSceneModelPolicies = {
  FCMscene1: { terrain: "land", requiresLanding: false },
  FCMscene2: { terrain: "land", requiresLanding: true },
  FCMwreckedplane1: { terrain: "land", requiresLanding: false },
  FCMsea1: { terrain: "water", requiresLanding: false },
  FCMsea2: { terrain: "water", requiresLanding: false },
  FCMsinkingboat2: { terrain: "water", requiresLanding: false },
  FCMsinkingboat4: { terrain: "water", requiresLanding: false },
  FCMcrashedplane6: { terrain: "land", requiresLanding: true },
  FCMcrashedcar2: { terrain: "land", requiresLanding: false },
  FCMwreckedplane4: { terrain: "land", requiresLanding: false }
};

const standardMissionScenes = {
  客运: { icon: "plane", label: "定期航线", objective: "按计划完成旅客运输和安全落地" },
  货运: { icon: "package", label: "货运航线", objective: "按任务要求完成货物运输" },
  包机: { icon: "briefcase-business", label: "包机航线", objective: "完成客户指定的包机航段" },
  医疗: { icon: "heart-pulse", label: "医疗转运", objective: "平稳完成医疗人员或物资转运" }
};

const missionArrivalRules = {
  landing: { radiusNm: 0.5, dwellSeconds: 15, speedLimitKt: 5 },
  "low-altitude": { radiusNm: 1, dwellSeconds: 0, speedLimitKt: 140 }
};

const achievementDefs = [
  { id: "first-flight", title: "首飞", desc: "完成第一段飞行。", test: (s) => s.stats.completedMissions >= 1 },
  { id: "ten-hours", title: "十小时", desc: "累计飞行 10 小时。", test: (s) => s.stats.totalHours >= 10 },
  { id: "twenty-hours", title: "基础资历", desc: "累计飞行 20 小时，完成副驾阶段。", test: (s) => s.stats.totalHours >= 20 },
  { id: "fifty-hours", title: "五十小时", desc: "累计飞行 50 小时。", test: (s) => s.stats.totalHours >= 50 },
  { id: "hundred-landings", title: "百次起降", desc: "完成 100 次起降。", test: (s) => s.stats.totalLandings >= 100 },
  { id: "five-hundred-landings", title: "起降专家", desc: "完成 500 次起降。", test: (s) => s.stats.totalLandings >= 500 },
  { id: "fleet-owner", title: "机队拥有者", desc: "购买或租用 3 架飞机。", test: (s) => s.fleet.some((a) => a.owned || a.rented) && s.fleet.filter((a) => a.owned || a.rented).length >= 3 },
  { id: "fleet-master", title: "大型机队", desc: "拥有或租用 10 架飞机。", test: (s) => s.fleet.filter((a) => a.owned || a.rented).length >= 10 },
  { id: "captain", title: "机长", desc: "晋升到机长。", test: (s) => getRankInfo(s.stats.totalHours).minHours >= 120 },
  { id: "senior-instructor", title: "高级教员", desc: "累计飞行达到 500 小时。", test: (s) => s.stats.totalHours >= 500 },
  { id: "flight-veteran", title: "资深飞行员", desc: "累计飞行达到 1,000 小时。", test: (s) => s.stats.totalHours >= 1000 },
  { id: "long-distance", title: "远程航线", desc: "累计飞行 100,000 海里。", test: (s) => s.stats.totalMiles >= 100000 },
  { id: "mission-veteran", title: "任务老兵", desc: "完成 50 个航班任务。", test: (s) => s.stats.completedMissions >= 50 },
  { id: "mission-commander", title: "任务指挥官", desc: "完成 250 个航班任务。", test: (s) => s.stats.completedMissions >= 250 },
  { id: "fuel-manager", title: "燃油管理师", desc: "累计消耗 10,000 千克燃油。", test: (s) => s.stats.totalFuelKg >= 10000 },
  { id: "fuel-budget", title: "燃油预算专家", desc: "累计燃油支出达到 10,000。", test: (s) => s.stats.totalFuelCost >= 10000 },
  { id: "logbook-keeper", title: "飞行记录员", desc: "完成 10 条飞行日志记录。", test: (s) => s.stats.manualLogs >= 10 || s.logs.length >= 10 },
  { id: "medical-response", title: "医疗响应", desc: "完成一次医疗或紧急任务。", test: (s) => s.missions.some((m) => m.status === "completed" && (m.category === "医疗" || m.priority === "emergency")) },
  { id: "type-rated", title: "机型签派员", desc: "取得 5 个机型考核执照。", test: (s) => (s.licenses || []).filter((license) => license.purchased && license.assessmentCompleted).length >= 5 },
  { id: "company-founder", title: "航空公司创始人", desc: "创建一家航空公司。", test: (s) => s.company?.created === true },
  { id: "company-fleet", title: "公司机队", desc: "为公司配备 3 架飞机。", test: (s) => (s.company?.aircraftIds || []).length >= 3 },
  { id: "company-crew", title: "机组团队", desc: "公司拥有 5 名在岗飞行员。", test: (s) => (s.company?.pilots || []).filter((pilot) => pilot.status === "active").length >= 5 }
];

// state 的初始化移至 04-state-core.js（defaultState 定义之后）。

