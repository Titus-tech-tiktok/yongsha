'use strict';

const path = require('node:path');

const GLOBAL_NEGATIVE_PROMPT = `全局负向约束：
不得改变家具主体结构、品类、比例、柜门、抽屉、层板、柜脚、把手、边框、五金件和可见尺寸关系。
不得改变印花内容、颜色、明暗、饱和度、元素、文字、布局和相对位置。
不得只截取印花局部，不得把印花变成浮雕、3D凸起、悬浮物、雕刻件、挂件或真实装饰件。
不得让光影改变家具本体颜色和印花颜色。
不得出现货不对板、结构错乱、门数错误、柜脚缺失、边框变形、印花错位、白边、黑边、脏边、残影、断裂、局部缺失。`;

const MASTER_PROMPT_TEMPLATE = `你是母版图生成前的提示词反推模型。请同时观察上传的品类款式图和印花图，只输出一份用于生成“单张母版图”的中文生图提示词。

最高优先级规则：
1. 以品类款式图为产品结构唯一依据，完整保持家具品类、外形、横竖版方向、比例、透视、柜门线、抽屉线、层板、边框、柜脚、把手和五金件。
2. 以印花图为图案唯一依据，必须尽量完整保留整体内容、布局、主要元素、文字和色块关系，不得只截取局部，不得重新设计。
3. 印花必须作为二维平面印刷图案贴合在家具正面可贴图区。即使原素材带浮雕感、3D感、阴影、高光或厚涂感，也必须压平成UV打印、贴膜、喷绘或平面彩绘效果。
4. 根据家具与印花的横竖方向进行等比例适配。允许为适配柜门边界做整体缩放和必要留白，但禁止拉伸、挤压、变形和切掉核心内容。
5. 印花不得覆盖外框、侧板厚度、柜脚、把手、地面、背景和阴影；柜门分缝必须自然保留在印花表面。
6. 融合边缘必须干净贴合，禁止白边、黑边、脏边、残影、断裂、错位、局部缺失、悬浮、凸起、竖条和投影溢出。
7. 如果品类图包含尺寸线或尺寸文字，只用于理解真实比例，不得把尺寸标注复制进母版图。
8. 最终母版必须是干净、完整、真实的商品图，不加标题、标签、水印、装饰边框和营销文案。

输出要求：
- 直接输出可执行的母版生图提示词；
- 明确写出产品结构保持、印花完整平面化、方向适配、覆盖边界和缺陷禁止项；
- 不输出分析过程，不输出多个方案。

母版生图固定约束：
使用输入的品类款式图作为产品结构基准，使用输入的印花图作为唯一图案基准，生成一张干净的电商母版商品图。
家具结构、比例、柜门/抽屉/柜脚/把手/边框必须与品类图一致；印花必须完整、等比例、二维平面化地贴合在正面可贴图区，不得浮雕、立体、悬浮、重绘、变色或只取局部。保留真实柜门分缝和边框，清除尺寸标注、营销文字、水印和无关背景。输出真实、清晰、可继续用于生成电商主图的母版图。

${GLOBAL_NEGATIVE_PROMPT}`;

const TEMPLATE_ANALYSIS_PROMPT = `请把这张电商套图模板图分析成可复用的“模板换印花说明书”。只输出合法 JSON，不要 Markdown，不要解释。
后续正式处理会用确定性像素合成，而不是让模型重新绘制。你必须先判断图片在整套商品链接里的用途，再判断是否存在清晰可见、属于家具外侧的白色或浅色柜门、抽屉正面或面板。

决策顺序：
1. 识别图片用途：主图、场景图、尺寸图、细节图、物流包装、安装售后、纯文字说明或其他必要详情页。
2. 套图文件夹里的图片默认都需要进入最终输出；没有可印花表面不等于删除图片。
3. 有清晰可见、边界明确的家具外侧白色面板时，processingMode=replace_print，并为每块面板输出精确多边形。
4. 图片仍有上架价值但没有可印花表面时，processingMode=copy_original，后端会逐字节复制原图，不调用生图 API。
5. 遮挡、内外侧、透视边界或多宫格中的任一小图无法可靠判断时，processingMode=manual_check。
6. AI 不允许选择 exclude；只有运营可以手动排除图片。

按这个结构输出：
{
  "version": 9,
  "imageRole": "主图/场景图/尺寸图/细节图/材质图/包装物流/安装售后/买家须知/纯文字页/多图拼接/不确定",
  "includeInOutput": true,
  "processingMode": "replace_print/copy_original/manual_check",
  "confidence": 0.0,
  "imageUnderstanding": "客观描述图片用途、家具角度、开合状态以及选择该动作的原因，80字以内",
  "viewState": "正面闭合/侧面/背面/俯视/开门/开抽屉/半开/局部特写/多角度拼图/无商品",
  "printableArea": "逐项说明允许换印花的家具外侧面板；无则写无",
  "printableSurfaces": [
    {
      "id": "front-door-1",
      "label": "左起第一扇白色柜门外表面",
      "polygon": [[0.16,0.47],[0.32,0.47],[0.32,0.78],[0.16,0.78]],
      "surfaceState": "外侧闭合"
    }
  ],
  "mappingMode": "continuous_across_surfaces",
  "preserveAreas": "必须保持不变的文字、背景、结构、门缝、把手、边框、柜脚、道具、阴影、人物和前景遮挡",
  "riskPoints": ["容易出错的点"],
  "needs_manual_check": false
}

硬性规则：
- V9 结构中的所有字段都必须完整输出，不得省略；无法可靠填写时将 processingMode 设为 manual_check 并说明原因。
- 坐标以整张图片左上角为 (0,0)、右下角为 (1,1)，polygon 至少 4 个点并沿面板边界顺序排列。
- 不得输出旧版 replace_regions 矩形；replace_print 只能使用 printableSurfaces 多边形标注真实面板边界。
- 只标家具外侧可见白色/浅色面板。墙面、地面、文字、尺寸线、标签、人物、背景、道具、阴影、门缝、把手、边框、柜脚、柜体内部、门内侧和抽屉内侧不得进入多边形。
- 主图、场景图、尺寸图、SKU 图、细节图或材质图没有可印花表面时应 copy_original，不得删除，也不得强行贴印花。
- 物流、包装、安装售后、买家须知、纯文字说明、侧面、背面、内部或运输详情页通常 copy_original。
- 多宫格必须逐个小图确认；任一需要换印花的小图边界不清楚时整张 manual_check。
- confidence 低于 0.75 时 processingMode=manual_check，needs_manual_check=true。
- replace_print 必须给出具体 printableArea 和至少一个有效 printableSurfaces 多边形；没有有效多边形时必须改为 manual_check，不能伪装成可执行的换印花结果。`;

function selectPathApi(...values) {
  return values.some(value => /^[A-Za-z]:[\\/]/.test(String(value || '')) || String(value || '').includes('\\'))
    ? path.win32
    : path.posix;
}

function basenameAny(value) {
  const text = String(value || '');
  return selectPathApi(text).basename(text);
}

function dirnameAny(value) {
  const text = String(value || '');
  if (!text) return '';
  const api = selectPathApi(text);
  const result = api.dirname(text);
  return result === '.' ? '' : result;
}

function fileNameWithoutExtension(value) {
  const text = String(value || '');
  const api = selectPathApi(text);
  const name = api.basename(text);
  return name.slice(0, name.length - api.extname(name).length);
}

function safeWindowsFileName(value) {
  const cleaned = String(value || '').replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_');
  return cleaned.trim() ? cleaned : 'task';
}

function replaceLiteral(value, search, replacement) {
  return String(value).split(search).join(String(replacement));
}

function taskField(task, camelName, pascalName) {
  if (task && Object.prototype.hasOwnProperty.call(task, camelName)) return String(task[camelName] || '');
  if (task && Object.prototype.hasOwnProperty.call(task, pascalName)) return String(task[pascalName] || '');
  return '';
}

function extractProductNamingParts(productPath, categoriesPath) {
  const api = selectPathApi(productPath, categoriesPath);
  const categoriesRoot = String(categoriesPath || '').trim() ? api.resolve(String(categoriesPath)) : '';
  const fullProduct = api.resolve(String(productPath));

  if (categoriesRoot && fullProduct.toLocaleLowerCase('en-US').startsWith(categoriesRoot.toLocaleLowerCase('en-US'))) {
    const relative = api.relative(categoriesRoot, fullProduct);
    const parts = relative.split(/[\\/]/);
    if (parts.length >= 2) {
      return [safeWindowsFileName(parts[0]), safeWindowsFileName(parts[1])];
    }
    if (parts.length === 1) {
      const parent = basenameAny(dirnameAny(productPath)) || '品类';
      return [safeWindowsFileName(parent), safeWindowsFileName(fileNameWithoutExtension(parts[0]))];
    }
  }

  const parent = basenameAny(dirnameAny(productPath)) || '品类';
  return [safeWindowsFileName(parent), safeWindowsFileName(fileNameWithoutExtension(productPath))];
}

function extractPrintCode(printPath) {
  const name = fileNameWithoutExtension(printPath);
  const match = name.match(/\p{Nd}+/u);
  return match ? match[0] : safeWindowsFileName(name);
}

function applyMasterPromptTemplate(template, task, categoriesPath = '') {
  const productPath = taskField(task, 'productPath', 'ProductPath');
  const printPath = taskField(task, 'printPath', 'PrintPath');
  const productName = fileNameWithoutExtension(productPath);
  const printName = fileNameWithoutExtension(printPath);
  const [categoryName, styleCode] = extractProductNamingParts(productPath, categoriesPath);
  const printCode = extractPrintCode(printPath);

  let result = String(template || '');
  result = replaceLiteral(result, '{产品文件名}', productName);
  result = replaceLiteral(result, '{印花文件名}', printName);
  result = replaceLiteral(result, '{品类}', categoryName);
  result = replaceLiteral(result, '{子品类}', styleCode);
  result = replaceLiteral(result, '{印花编号}', printCode);
  return result;
}

function productProfilePromptText(productProfile) {
  if (typeof productProfile === 'string') return productProfile;
  if (productProfile && typeof productProfile.ToPromptText === 'function') {
    return String(productProfile.ToPromptText());
  }
  if (productProfile && typeof productProfile.toPromptText === 'function') {
    return String(productProfile.toPromptText());
  }

  const dimensions = taskField(productProfile, 'dimensions', 'Dimensions');
  const material = taskField(productProfile, 'material', 'Material');
  const lines = [];
  if (dimensions.trim()) lines.push(`尺寸：${dimensions}`);
  if (material.trim()) lines.push(`材质：${material}`);
  return lines.length > 0
    ? lines.join('\n')
    : '未提供商品资料。尺寸和材质不得编造；缺资料的信息页应保守处理或复制模板。';
}

function applyTemplatePathPlaceholders(prompt, job) {
  const relativeTemplatePath = taskField(job, 'relativeTemplatePath', 'RelativeTemplatePath');
  const templateImagePath = taskField(job, 'templateImagePath', 'TemplateImagePath');
  let result = String(prompt);
  result = replaceLiteral(result, '{模板相对路径}', relativeTemplatePath);
  result = replaceLiteral(result, '{模板文件名}', basenameAny(templateImagePath));
  result = replaceLiteral(result, '{模板文件夹}', dirnameAny(relativeTemplatePath));
  return result;
}

function TEMPLATE_MIGRATION_PROMPT(job, templateAnalysis, productProfile, action, retryInstruction) {
  const relativeTemplatePath = taskField(job, 'relativeTemplatePath', 'RelativeTemplatePath');
  const profileText = productProfilePromptText(productProfile);
  const retry = retryInstruction == null ? '' : String(retryInstruction);
  const retryText = retry.trim() ? `上一次 AI 审核未通过，本次必须修正：${retry}` : '';

  const prompt = `你将根据一张“母版商品图”生成当前套图图片。生成阶段只看得到母版图；下面的 JSON 是另一张模板图的文字分析，只用于描述目标图片类型、场景、构图和排版。

最高优先级：
- 输入图片中的母版商品是唯一商品标准；模板分析只提供“这张图要做什么”，不是商品参考。
- 不得改变母版商品的品类、横竖比例、外轮廓、门板/抽屉/层板数量、柜脚、把手、边框、印花内容、印花位置、印花颜色、柜体颜色和材质观感。
- 不得从模板分析里复刻旧商品的图案、尺寸、材质、结构、开合状态、局部装饰或 SKU 商品图。
- 如果目标用途和母版结构冲突，以母版商品为准，放弃冲突动作；不要编造母版图没有展示的内部结构。
- 输出画面要完整保留商品主体，禁止裁掉主体，禁止压扁或拉伸商品；商品比例必须和母版一致。

当前商品资料：
${profileText}

模板图文字分析 JSON：
${String(templateAnalysis || '')}

当前生成动作：${String(action || '')}
模板相对路径：${relativeTemplatePath}

按动作执行：
- generate_product_scene：生成母版商品的场景图或主图，只参考 JSON 里的场景、构图、背景、道具和文字区域；商品本体必须来自母版。
- function_showcase：只展示母版商品真实存在且在母版图中可确认的功能结构；母版图没有展示的开门、开抽屉、层板和内部空间不要新增，宁可保持闭合外观。
- generate_detail_showcase：从母版商品真实可见局部做细节图，例如印花局部、边框、柜脚、把手、台面或可见纹理；必须放大母版中的真实细节，不要生成模板旧细节，不要把细节图变成完整场景图。
- generate_dimension_sheet：用母版商品做尺寸/SKU/规格图；只使用商品资料里的真实尺寸，没有尺寸就不要编数字；不要沿用模板旧尺寸和旧 SKU 图。
- generate_material_sheet：做材质/色卡说明页；只使用商品资料里的材质，没有材质就少写或留作示意；不要复制模板旧商品材质样块；只要模板分析 needs_master_product=true，画面里必须出现母版商品或母版商品的真实可见局部，不能生成纯文字页。

质量底线：
- 任何时候都不要为了贴合模板而把母版商品改成另一件商品。
- 模板要求的局部如果母版图里不可见，就选择母版图里最接近的可见局部保守生成，不要想象新结构。
- 文案和图标可以参考模板排版，但商品相关内容必须来自母版商品和当前商品资料。
- 如果模板是开门/开抽屉/内部收纳展示，而母版图没有清楚展示同样的开启结构，则不要生成打开状态；应保持母版商品闭合外观，只参考模板的说明文字、排版和场景氛围。
- 如果模板是细节页，但母版图没有对应细节，优先展示母版图可见的真实细节，例如正面印花、边框、把手、柜脚、门缝、台面；不得复制模板旧商品的局部。
- 如果模板是尺寸/规格页，尺寸数字必须来自商品资料或母版图可读尺寸；没有可靠尺寸时不要编造数字，可以保留排版但弱化具体数值。
- 如果模板是材质/包装/物流/售后/买家须知/纯文字信息页，且 action=copy_template 或 skip_copy，应保留原模板，不要强行加入母版商品。

${retryText}

直接输出最终成品图，不要输出解释文字。`;

  return applyTemplatePathPlaceholders(prompt, job);
}

function TEMPLATE_PRINT_PROMPT(job, templateAnalysis, hasMask = false) {
  // Windows V8 接收 hasMask，但当前提示词正文并未按它分支。
  void hasMask;
  const relativeTemplatePath = taskField(job, 'relativeTemplatePath', 'RelativeTemplatePath');

  const prompt = `你将根据输入图生成一张电商套图成品图。
第一张输入图是原始套图模板图，必须作为画面尺寸、比例、构图、场景、文字、版式、透视和家具结构的唯一模板。
第二张输入图是原始印花图，必须作为柜门/抽屉/面板表面图案的唯一来源。

最高优先级：
- 这是“套图模板换印花”任务，不是重新设计家具，也不是整图重绘。
- 只在模板分析 JSON 的 replace_area / print_mapping 描述的家具留白表面换成第二张印花图。
- 模板里图片是什么角度、什么开门状态、什么背面/侧面状态，最终图就保持什么状态；只改变留白家具表面的图案。
- 除可换印花面板外，整张模板图都应尽量保持像素级不变。
- 保持第一张模板图的画面尺寸、构图、背景、灯光、阴影、文字、图标、尺寸线、地面、墙面、道具、五金件、柜脚、把手、边框、柜体结构和开合状态不变。
- 必须把第二张印花当作“一张完整画面”来使用：家具留白表面最终呈现的图案应与第二张印花一致，保持图案主体、相对位置、方向、横竖比例、颜色和完整结构。
- 禁止把整张印花图当作小 tile 重复平铺；禁止复制多个完整印花主体；禁止把一个卡通人物、动物、建筑、花鸟主视觉重复铺满柜门。
- 如果留白表面由多扇连续柜门/抽屉组成，优先让一张完整印花跨多个门板连续显示，门缝、抽屉缝和把手保留在印花上方。
- 如果留白表面是多个互不相连的小面板，应按模板分析的 print_mapping 处理；不确定时保守，不要把印花乱铺到所有位置。
- 如果柜门区域比印花画面更宽或更窄，优先等比例缩放并居中裁切/延展边缘背景；不能拉伸变形，不能重复主视觉。
- 只有当原始印花本身就是连续纹理、小碎花、纯几何或明显无缝底纹时，才允许自然延展；即使延展，也不能改变原图元素比例、颜色和方向。
- forbidden_area 中列出的区域绝对不能被替换、涂抹、重绘或覆盖。
- 不得替换白墙、白地毯、白色文字区域、白色标签、白色背景、包装盒、说明页留白、抽屉内侧、柜门内侧、背板、阴影或非家具面板区域。
- 如果 replace_area 是“无”“不确定”或类似“整张图、所有区域、商品整体”的泛化描述，不要强行添加印花，应保守保持模板原图。
- 印花必须像一整张平面印刷/贴膜一样贴合在柜门或面板表面，跟随模板透视、门缝、抽屉缝、面板边界和遮挡关系；不得变成立体装饰、浮雕、贴纸、挂件、背景图或独立画框。
- 印花只改变面板表面图案，不改变柜体颜色、材质、门板形状、抽屉形状、边框厚度、开合状态、透视结构和商品尺寸。
- 保留门缝、抽屉缝、把手、边框、柜体黑色/木色部分、柜脚、内部空间和原有阴影。
- 如果模板是开抽屉或开柜门，只能替换可见正面外板；不能把印花贴到抽屉内侧、柜门内侧、柜体内部、背板或阴影里。
- 如果模板是背面图，只能在分析明确写出“背面留白表面可换印花”时处理；否则保持原模板或保守处理。
- 如果是多宫格、多场景或拼图模板，只处理模板分析 JSON 明确点名的小图区域；没有点名的小图区域保持原样。
- 如果替换区域被把手、门缝、边框、文字、图标、阴影或前景物体遮挡，遮挡物必须保留在印花上方，不得被印花覆盖。
- 如果模板分析标记为 copy_template、skip_copy 或 manual_check，本次不应进入生图；如果误进入，仍必须保守处理，不要强行添加印花。
- 输出文件必须与模板图同版式、同画幅、同商品结构，只改变可印花面板的印花内容。

模板图文字分析 JSON：
${String(templateAnalysis || '')}

当前模板相对路径：${relativeTemplatePath}

直接输出最终成品图，不要输出解释文字。`;

  return applyTemplatePathPlaceholders(prompt, job);
}

module.exports = {
  GLOBAL_NEGATIVE_PROMPT,
  MASTER_PROMPT_TEMPLATE,
  TEMPLATE_ANALYSIS_PROMPT,
  TEMPLATE_MIGRATION_PROMPT,
  TEMPLATE_PRINT_PROMPT,
  applyMasterPromptTemplate
};
