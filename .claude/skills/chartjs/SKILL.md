---
name: chartjs
description: Chart.js(v4) 라이브러리로 인터랙티브 차트를 만드는 스킬. 막대·선·파이·도넛·레이더·산점도·버블·혼합 차트 등을 HTML/artifact에 canvas로 렌더한다. "차트 그려줘", "그래프 만들어줘", "막대/선/파이 차트", "Chart.js로", "데이터 시각화 붙여줘", "대시보드에 그래프", "이 수치를 차트로" 등 브라우저에서 보일 차트를 만들 때 사용. 차트의 색·접근성·레이아웃 설계 원칙은 dataviz 스킬을 함께 참고하고, 이 스킬은 Chart.js 구현을 담당한다. 정적 PNG/보고서용 차트가 아니라 웹에서 상호작용하는 차트에 적합하다.
---

# chartjs

Chart.js v4로 캔버스 기반 인터랙티브 차트를 만든다. 요청에 차트/그래프가 포함되면 적절한 차트 타입·설정을 스스로 골라 적용한다.

## 먼저: 설계 원칙은 dataviz

색상 팔레트, 범례·축·툴팁, 접근성(대비·색각), 차트 타입 선택 기준은 **`dataviz` 스킬을 먼저 따른다**. 이 스킬은 그 원칙을 Chart.js 코드로 구현하는 부분을 담당한다. 둘이 충돌하면 dataviz의 디자인 규칙을 우선한다.

## CDN 포함 (artifact/HTML)

exact 버전을 고정한다(최소 2주 경과 버전). cdnjs 사용:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<canvas id="c" width="640" height="360"></canvas>
```

## 최소 예제

```html
<script>
const ctx = document.getElementById('c');
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: ['1월','2월','3월','4월'],
    datasets: [{ label: '매출(백만원)', data: [12, 19, 8, 15] }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' }, tooltip: { enabled: true } },
    scales: { y: { beginAtZero: true } }
  }
});
</script>
```

## 차트 타입 선택 (기본 가이드)

| 데이터 | 타입 |
|--------|------|
| 범주 비교 | `bar` (가로는 `indexAxis:'y'`) |
| 시간 추세 | `line` (영역은 `fill:true`) |
| 구성비(≤5) | `doughnut`/`pie` |
| 다변량 비교 | `radar` |
| 상관/분포 | `scatter`/`bubble` |
| 서로 다른 축 | 혼합(`type` dataset별 지정 + 두 번째 y축) |

## 적용 규칙 (알아서 처리)

1. 요청에 수치 데이터가 있으면 타입을 추론해 바로 그린다. 애매하면 bar/line을 기본으로 하고 그 선택을 한 줄로 밝힌다.
2. 반응형: `responsive:true` + `maintainAspectRatio:false`를 쓰고 canvas를 높이 지정된 컨테이너에 넣는다.
3. 한글 라벨은 깨지지 않지만, 폰트를 지정할 때는 시스템 한글 폰트 폴백(`system-ui, 'Apple SD Gothic Neo','Noto Sans KR', sans-serif`)을 둔다.
4. 색은 dataviz 팔레트를 쓰고, 데이터셋이 많을 때 임의 난색 남발을 피한다. 라이트/다크 모두에서 읽히게 축·그리드 색을 토큰화한다.
5. 접근성: 색만으로 구분하지 말고 라벨·패턴·직접 레이블을 병행한다. 툴팁에 단위를 넣는다.
6. 큰 데이터(수천 포인트+)는 `animation:false`, `spanGaps`, `decimation` 플러그인을 고려한다.

## 주의

- 정적 이미지(PNG)·문서 삽입용 차트가 주 목적이면 Chart.js 대신 서버측 렌더(matplotlib 등)나 dataviz의 다른 경로가 나을 수 있음을 알린다. Chart.js는 브라우저 렌더 전용이다.
- artifact로 낼 때는 외부 스크립트를 cdnjs의 exact 버전으로만 로드하고, 데이터는 인라인으로 둔다.
- 설치된 소스 포크: `huntbae/chart.js` v4.6.1. CDN은 안정 고정 버전(4.4.1)을 기본 사용하되, 특정 버전이 필요하면 맞춰 교체한다.
