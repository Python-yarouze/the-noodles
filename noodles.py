from itertools import combinations

ESSENTIAL = ["ごはん", "めん"]
PROTEIN = ["えび", "ぶた", "とり", "たまご", "バター"]
SEASONING = ["しょうゆ", "みそ", "しお"]
TOPPING = ["しょうが", "もやし", "ねぎ", "にんにく", "コーン", "きのこ", "めんま"]

class CalcCardPoint:
    def __init__(self, cards):
        self.cards = cards

        # カードと計算関数のマッピング
        self.card_methods = {
            "めん": self.noodle,
            "ごはん": self.rice,
            "えび": self.shrimp,
            "もやし": self.sprout,
            "めんま": self.menma,
            "みそ": self.miso,
            "ぶた": self.pork,
            "バター": self.butter,
            "ねぎ": self.onion,
            "にんにく": self.garlic,
            "とり": self.chicken,
            "たまご": self.egg,
            "しょうゆ": self.soy_sauce,
            "しょうが": self.ginger,
            "しお": self.salt,
            "コーン": self.corn,
            "きのこ": self.mushroom
        }

    def noodle(self):
        return 1

    def shrimp(self):
        if "しょうが" in self.cards and "しょうゆ" in self.cards:
            return 11
        if "しょうが" in self.cards:
            return 9
        return 6
        
    def rice(self):
        if len(self.cards) == 4 and any(i in self.cards for i in PROTEIN) and any(i in self.cards for i in SEASONING) and any(i in self.cards for i in TOPPING):
            return 8
        return 1

    def sprout(self):
        if "ぶた" in self.cards or "とり" in self.cards:
            return 7
        if "たまご" in self.cards:
            return 4
        return 0

    def menma(self):
        if not any(i in self.cards for i in TOPPING[:-1]):
            return 4
        return 2

    def miso(self):
        if "コーン" in self.cards and "バター" in self.cards:
            return 9
        if "コーン" in self.cards:
            return 4
        return 1

    def pork(self):
        if "きのこ" in self.cards:
            return 8
        return 5

    def butter(self):
        if "きのこ" in self.cards and "しょうゆ" in self.cards:
            return 5
        if "きのこ" in self.cards:
            return 3
        return 1

    def onion(self):
        if "えび" in self.cards:
            return 4
        return 3

    def garlic(self):
        return -2 # 後で2倍

    def chicken(self):
        if "ねぎ" in self.cards and "しょうが" in self.cards:
            return 7
        if "ねぎ" in self.cards:
            return 5
        return 3

    def egg(self):
        if any(i in self.cards for i in SEASONING):
            return 5
        return 3

    def soy_sauce(self):
        if "しょうが" in self.cards:
            return 3
        if "ねぎ" in self.cards:
            return 2
        return 1

    def ginger(self):
        if "ぶた" in self.cards:
            return 4
        return 2

    def salt(self):
        if len(self.cards) == 5 and not any(i in self.cards for i in PROTEIN):
            return 12
        if any(i in self.cards for i in SEASONING):
            return -2
        return 0

    def corn(self):
        if "とり" in self.cards:
            return 3
        return 1

    def mushroom(self):
        if "とり" in self.cards:
            return 3
        return 2

    def calc(self):
        """カードの合計点数を計算"""
        total = 0
        
        # 各カードの点数を計算
        for card in self.cards:
            if card in self.card_methods:
                points = self.card_methods[card]()
                total += points
        
        # にんにくがある場合は合計を2倍
        if "にんにく" in self.cards:
            total *= 2
        
        return total

def generate_all_combinations():
    """すべてのカードの組み合わせ（3～5枚）を生成して点数を計算"""
    # ESSENTIAL以外のカード
    other_cards = PROTEIN + SEASONING + TOPPING
    
    results = []
    
    # 3枚、4枚、5枚の組み合わせをそれぞれ生成
    for n in range(3, 6):
        # ESSENTIALから1枚選択
        for essential_card in ESSENTIAL:
            # 残りのn-1枚をother_cardsから選択
            for combo in combinations(other_cards, n - 1):
                cards = [essential_card] + list(combo)
                calc = CalcCardPoint(cards)
                points = calc.calc()
                results.append((cards, points))
    
    return results


def print_all_combinations(show_all=False):
    """すべての組み合わせを一覧表示"""
    results = generate_all_combinations()
    
    # 点数でソート
    results.sort(key=lambda x: x[1], reverse=True)
    
    print(f"総組み合わせ数: {len(results)}\n")
    
    if show_all:
        # すべて表示
        print("=" * 80)
        for cards, points in results:
            cards_str = "、".join(cards)
            print(f"{points:3d}点 | {cards_str}")
    else:
        # TOP10を表示
        print("【TOP10】")
        print("=" * 80)
        for cards, points in results[:10]:
            cards_str = "、".join(cards)
            print(f"{points:3d}点 | {cards_str}")
        
        # UNDER10を表示
        print("\n【UNDER10（下位10件）】")
        print("=" * 80)
        for cards, points in results[-10:]:
            cards_str = "、".join(cards)
            print(f"{points:3d}点 | {cards_str}")
    
    # 統計情報
    points_list = [p for _, p in results]
    print("\n" + "=" * 80)
    print(f"最高点: {max(points_list)}点")
    print(f"最低点: {min(points_list)}点")
    print(f"平均点: {sum(points_list)/len(points_list):.2f}点")

def suggest_improvements(current_cards):
    """現在の手札に対して改善案を提案"""
    # すべてのカード
    all_cards = ESSENTIAL + PROTEIN + SEASONING + TOPPING
    
    # 現在の点数を計算
    current_calc = CalcCardPoint(current_cards)
    current_points = current_calc.calc()
    
    print(f"【現在の手札】")
    print(f"カード: {' / '.join(current_cards)}")
    print(f"現在の点数: {current_points}点\n")
    
    suggestions = []
    
    # 1. カードを1枚交換する場合
    for i, old_card in enumerate(current_cards):
        # ESSENTIALカードを交換する場合は、別のESSENTIALカードと交換
        if old_card in ESSENTIAL:
            for new_card in ESSENTIAL:
                if new_card not in current_cards:
                    new_hand = current_cards[:i] + [new_card] + current_cards[i+1:]
                    new_calc = CalcCardPoint(new_hand)
                    new_points = new_calc.calc()
                    
                    if new_points > current_points:
                        diff = new_points - current_points
                        suggestions.append({
                            'type': '交換',
                            'action': f'「{old_card}」→「{new_card}」',
                            'result_hand': new_hand,
                            'points': new_points,
                            'diff': diff
                        })
        else:
            # ESSENTIAL以外のカードは任意のカード（ただし既に持っていないもの）と交換可能
            for new_card in all_cards:
                if new_card not in current_cards:
                    new_hand = current_cards[:i] + [new_card] + current_cards[i+1:]
                    new_calc = CalcCardPoint(new_hand)
                    new_points = new_calc.calc()
                    
                    if new_points > current_points:
                        diff = new_points - current_points
                        suggestions.append({
                            'type': '交換',
                            'action': f'「{old_card}」→「{new_card}」',
                            'result_hand': new_hand,
                            'points': new_points,
                            'diff': diff
                        })
    
    # 2. カードを1枚追加する場合（手札が5枚未満の場合）
    if len(current_cards) < 5:
        for new_card in all_cards:
            if new_card not in current_cards:
                # 追加後の手札
                new_hand = current_cards + [new_card]
                new_calc = CalcCardPoint(new_hand)
                new_points = new_calc.calc()
                
                if new_points > current_points:
                    diff = new_points - current_points
                    suggestions.append({
                        'type': '追加',
                        'action': f'「{new_card}」を追加',
                        'result_hand': new_hand,
                        'points': new_points,
                        'diff': diff
                    })
    
    # 点数の上昇幅でソート
    suggestions.sort(key=lambda x: x['diff'], reverse=True)
    
    if suggestions:
        print(f"【改善案 TOP10】")
        print("=" * 80)
        for i, sug in enumerate(suggestions[:10], 1):
            result_str = ' / '.join(sug['result_hand'])
            print(f"{i:2d}. [{sug['type']}] {sug['action']}")
            print(f"    → {sug['points']}点 (+{sug['diff']}点) | {result_str}")
            print()
    else:
        print("改善案が見つかりませんでした。現在の手札が最適かもしれません！")
    
    return suggestions

# 使用例
if __name__ == "__main__":
    # TOP10とUNDER10を表示
    print_all_combinations()
    
    # すべて表示したい場合は show_all=True
    # print_all_combinations(show_all=True)

    # テストケース
    test_cases = [
        ["めん", "えび", "しょうが", "しょうゆ"],
        ["ごはん", "ぶた", "みそ", "ねぎ"],
        ["めん", "にんにく", "ぶた"],
        ["ごはん", "たまご", "しょうゆ", "ねぎ"],
        ["めん", "バター", "コーン", "みそ", "きのこ"]
    ]
    
    for cards in test_cases:
        calc = CalcCardPoint(cards)
        points = calc.calc()
        print(f"{cards} → {points}点")

    # 改善案の提案例
    print("\n\n【改善案の提案】")
    print("=" * 80)
    current_hand = ["めん", "えび", "ぶた"]
    suggest_improvements(current_hand)