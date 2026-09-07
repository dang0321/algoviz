/* algoviz — 겉면. 실제 내용은 세 파일에 나뉘어 있다.
 *
 *   viz-util.js    이 값이 무엇처럼 생겼는가 (공용 판별기)
 *   viz-layout.js  DOM/SVG 만들기, 좌표 계산
 *   viz-detect.js  타임라인을 보고 무엇을 그릴지 정한다  <- 유형 추가는 여기
 *   viz-render.js  화면에 만들고 프레임마다 갱신한다
 *
 * index.html 에서 이 순서대로 읽어야 한다 (util -> layout -> detect -> render -> viz).
 */
const Viz = {
  analyze: VizDetect.analyze,
  mount: VizRender.mount,
  update: VizRender.update,
};
