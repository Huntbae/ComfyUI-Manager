"""편마다 다른 사진 스타일 프리셋.

20편 각각 다른 인상을 주되, 한 편 안의 2장은 같은 스타일로 묶어 글이 따로 놀지 않게 한다.
가로폭은 810px로 고정하고 비율·톤·마감만 바꾼다.

각 프리셋 필드
    name       한글 이름 (로그·문서용)
    ratio      (가로, 세로) 비 — 810px 기준으로 높이가 정해진다
    contrast   대비 배율 (1.0 = 그대로)
    color      채도 배율 (0.0 = 흑백)
    brightness 밝기 배율
    tint       채널별 배율 (R, G, B). 색조를 살짝 미는 용도
    finish     항상 None. 테두리·둥근 모서리는 카드뉴스처럼 보여서 쓰지 않는다.
"""

BASE_WIDTH = 810

STYLES = [
    dict(name="자연 4:3",        ratio=(4, 3),  contrast=1.04, color=1.00, brightness=1.01, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="따뜻한 필름 3:2", ratio=(3, 2),  contrast=0.96, color=1.05, brightness=1.05, tint=(1.05, 1.00, 0.94), finish=None),
    dict(name="차분한 무채 4:3", ratio=(4, 3),  contrast=1.02, color=0.72, brightness=1.00, tint=(0.98, 1.00, 1.04), finish=None),
    dict(name="흑백 고대비 1:1", ratio=(1, 1),  contrast=1.25, color=0.00, brightness=0.99, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="세피아 4:3",      ratio=(4, 3),  contrast=1.06, color=0.18, brightness=1.03, tint=(1.10, 1.00, 0.86), finish=None),
    dict(name="딥 콘트라스트 16:9", ratio=(16, 9), contrast=1.22, color=0.96, brightness=0.96, tint=(1.00, 1.00, 1.02), finish=None),
    dict(name="하이키 4:3",      ratio=(4, 3),  contrast=0.92, color=0.88, brightness=1.12, tint=(1.02, 1.01, 1.00), finish=None),
    dict(name="로우키 3:2",      ratio=(3, 2),  contrast=1.18, color=0.90, brightness=0.88, tint=(1.00, 0.99, 1.02), finish=None),
    dict(name="빈티지 페이드 4:3", ratio=(4, 3), contrast=0.86, color=0.82, brightness=1.08, tint=(1.06, 1.01, 0.96), finish=None),
    dict(name="선명 16:9",       ratio=(16, 9), contrast=1.10, color=1.22, brightness=1.00, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="맑은 4:3",        ratio=(4, 3),  contrast=1.05, color=1.00, brightness=1.02, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="차분한 3:2",      ratio=(3, 2),  contrast=1.05, color=1.02, brightness=1.01, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="부드러운 흑백 3:2", ratio=(3, 2), contrast=1.02, color=0.00, brightness=1.06, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="앰버 4:3",        ratio=(4, 3),  contrast=1.05, color=1.05, brightness=1.02, tint=(1.08, 1.00, 0.90), finish=None),
    dict(name="틸 16:9",         ratio=(16, 9), contrast=1.06, color=1.00, brightness=1.00, tint=(0.94, 1.02, 1.07), finish=None),
    dict(name="정방 자연 1:1",   ratio=(1, 1),  contrast=1.03, color=1.00, brightness=1.02, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="시네마 21:9",     ratio=(21, 9), contrast=1.12, color=0.94, brightness=0.98, tint=(1.00, 1.00, 1.01), finish=None),
    dict(name="바랜 색감 4:3",   ratio=(4, 3),  contrast=0.90, color=0.78, brightness=1.09, tint=(1.05, 1.02, 0.95), finish=None),
    dict(name="흑백 정방 1:1",   ratio=(1, 1),  contrast=1.14, color=0.00, brightness=1.00, tint=(1.00, 1.00, 1.00), finish=None),
    dict(name="파스텔 4:3",      ratio=(4, 3),  contrast=0.94, color=0.80, brightness=1.08, tint=(1.03, 1.02, 1.03), finish=None),
]

# 마감 처리 수치 (현재 어떤 프리셋도 쓰지 않는다 — 테두리 금지)
BORDER_PX = 22
ROUND_RADIUS = 28
# 4:3 등으로 자를 때 이만큼 넘게 잘려나가면 자르지 않고 여백을 채운다.
# (카드뉴스처럼 글자가 든 세로 이미지의 제목·푸터를 보호하기 위한 기준)
MAX_CROP_LOSS = 0.25


def size_for(style):
    """프리셋의 비율로 (가로, 세로)를 계산한다. 가로는 항상 BASE_WIDTH."""
    rw, rh = style["ratio"]
    return BASE_WIDTH, max(1, round(BASE_WIDTH * rh / rw))


def style_for(index):
    """편 번호(0부터)에 프리셋을 배정한다. 20편을 넘으면 순환한다."""
    return STYLES[index % len(STYLES)]
