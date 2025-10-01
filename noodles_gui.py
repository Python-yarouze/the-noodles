import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk
import os
import random

ESSENTIAL = ["ごはん", "めん"]
PROTEIN = ["えび", "ぶた", "とり", "たまご", "バター"]
SEASONING = ["しょうゆ", "みそ", "しお"]
TOPPING = ["しょうが", "もやし", "ねぎ", "にんにく", "コーン", "きのこ", "めんま"]

class CalcCardPoint:
    def __init__(self, cards):
        self.cards = cards
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
        if (len(self.cards) == 4 and 
            any(i in self.cards for i in PROTEIN) and 
            any(i in self.cards for i in SEASONING) and 
            any(i in self.cards for i in TOPPING)):
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
        return -2

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
        total = 0
        for card in self.cards:
            if card in self.card_methods:
                points = self.card_methods[card]()
                total += points
        if "にんにく" in self.cards:
            total *= 2
        return total


class CardGameGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("カードゲーム点数計算")
        self.root.geometry("1000x700")
        self.root.configure(bg="#f0f0f0")
        
        self.all_cards = ESSENTIAL + PROTEIN + SEASONING + TOPPING
        self.current_hand = ["めん", "えび", "ぶた"]
        self.card_images = {}
        self.card_images_small = {}
        
        self.load_card_images()
        self.create_widgets()
        self.update_display()

    def load_card_images(self):
        """カード画像を読み込む"""
        for card in self.all_cards:
            try:
                # 画像ファイルを読み込み
                img_path = f"{card}.png"
                if os.path.exists(img_path):
                    # 手札用（大きいサイズ）
                    img = Image.open(img_path)
                    img = img.resize((100, 140), Image.Resampling.LANCZOS)
                    self.card_images[card] = ImageTk.PhotoImage(img)
                    
                    # 利用可能カード用（小さいサイズ）
                    img_small = Image.open(img_path)
                    img_small = img_small.resize((70, 98), Image.Resampling.LANCZOS)
                    self.card_images_small[card] = ImageTk.PhotoImage(img_small)
                else:
                    # 画像がない場合はプレースホルダー
                    self.card_images[card] = None
                    self.card_images_small[card] = None
            except Exception as e:
                print(f"画像読み込みエラー ({card}): {e}")
                self.card_images[card] = None
                self.card_images_small[card] = None

    def create_widgets(self):
        """ウィジェットを作成"""
        # タイトル
        title_frame = tk.Frame(self.root, bg="#2c3e50", height=60)
        title_frame.pack(fill=tk.X)
        title_label = tk.Label(title_frame, text="カードゲーム点数計算", 
                              font=("Arial", 20, "bold"), bg="#2c3e50", fg="white")
        title_label.pack(pady=15)
        
        # 点数表示
        self.score_frame = tk.Frame(self.root, bg="#f0f0f0")
        self.score_frame.pack(pady=10)
        self.score_label = tk.Label(self.score_frame, text="現在の点数: 0点", 
                                    font=("Arial", 16, "bold"), bg="#f0f0f0", fg="#e74c3c")
        self.score_label.pack()
        
        # 手札フレーム
        hand_label = tk.Label(self.root, text="現在の手札（クリックで削除）", 
                             font=("Arial", 12, "bold"), bg="#f0f0f0")
        hand_label.pack(pady=(10, 5))
        
        self.hand_frame = tk.Frame(self.root, bg="#ecf0f1", relief=tk.RIDGE, bd=2)
        self.hand_frame.pack(pady=5, padx=20, fill=tk.X)
        
        # 利用可能なカードフレーム
        available_label = tk.Label(self.root, text="利用可能なカード（クリックで追加）", 
                                   font=("Arial", 12, "bold"), bg="#f0f0f0")
        available_label.pack(pady=(20, 5))
        
        # スクロール可能なフレーム
        canvas_frame = tk.Frame(self.root, bg="#f0f0f0")
        canvas_frame.pack(pady=5, padx=20, fill=tk.BOTH, expand=True)
        
        self.canvas = tk.Canvas(canvas_frame, bg="#ecf0f1", height=250)
        scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = tk.Frame(self.canvas, bg="#ecf0f1")
        
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
        
        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)
        
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # ボタンフレーム
        button_frame = tk.Frame(self.root, bg="#f0f0f0")
        button_frame.pack(pady=15)
        
        self.suggest_button = tk.Button(button_frame, text="改善案を表示", 
                                       font=("Arial", 12, "bold"),
                                       bg="#3498db", fg="white",
                                       padx=20, pady=10,
                                       command=self.show_suggestions)
        self.suggest_button.pack(side=tk.LEFT, padx=10)
        
        self.best_button = tk.Button(button_frame, text="最高得点の組み合わせ", 
                                     font=("Arial", 12, "bold"),
                                     bg="#e74c3c", fg="white",
                                     padx=20, pady=10,
                                     command=self.show_best_combinations)
        self.best_button.pack(side=tk.LEFT, padx=10)
        
        self.random_button = tk.Button(button_frame, text="ランダム選択", 
                                       font=("Arial", 12, "bold"),
                                       bg="#9b59b6", fg="white",
                                       padx=20, pady=10,
                                       command=self.random_hand)
        self.random_button.pack(side=tk.LEFT, padx=10)

    def update_display(self):
        """表示を更新"""
        # 点数更新
        calc = CalcCardPoint(self.current_hand)
        points = calc.calc()
        self.score_label.config(text=f"現在の点数: {points}点 ({len(self.current_hand)}/5枚)")
        
        # 手札表示更新
        for widget in self.hand_frame.winfo_children():
            widget.destroy()
        
        for i, card in enumerate(self.current_hand):
            card_btn = tk.Button(self.hand_frame, 
                               image=self.card_images[card] if self.card_images[card] else None,
                               text=card if not self.card_images[card] else "",
                               compound=tk.TOP,
                               font=("Arial", 10),
                               width=100 if not self.card_images[card] else None,
                               height=140 if not self.card_images[card] else None,
                               command=lambda c=card: self.remove_card(c))
            card_btn.pack(side=tk.LEFT, padx=5, pady=10)
        
        # 利用可能なカード表示更新
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        
        row = 0
        col = 0
        for card in self.all_cards:
            if card not in self.current_hand:
                card_btn = tk.Button(self.scrollable_frame,
                                   image=self.card_images_small[card] if self.card_images_small[card] else None,
                                   text=card if not self.card_images_small[card] else "",
                                   compound=tk.TOP,
                                   font=("Arial", 9),
                                   width=70 if not self.card_images_small[card] else None,
                                   height=98 if not self.card_images_small[card] else None,
                                   command=lambda c=card: self.add_card(c))
                card_btn.grid(row=row, column=col, padx=5, pady=5)
                
                col += 1
                if col >= 8:
                    col = 0
                    row += 1

    def add_card(self, card):
        """カードを手札に追加"""
        if len(self.current_hand) < 5 and card not in self.current_hand:
            self.current_hand.append(card)
            self.update_display()

    def remove_card(self, card):
        """カードを手札から削除"""
        # ESSENTIALカードが1枚しかない場合は削除不可
        if card in ESSENTIAL:
            essential_count = sum(1 for c in self.current_hand if c in ESSENTIAL)
            if essential_count <= 1:
                return
        
        self.current_hand.remove(card)
        self.update_display()

    def show_suggestions(self):
        """改善案を表示"""
        suggestions = self.generate_suggestions()
        
        # 新しいウィンドウを作成
        suggestion_window = tk.Toplevel(self.root)
        suggestion_window.title("改善案")
        suggestion_window.geometry("800x600")
        suggestion_window.configure(bg="#f0f0f0")
        
        # タイトル
        title_label = tk.Label(suggestion_window, text="改善案 TOP20", 
                              font=("Arial", 16, "bold"), bg="#f0f0f0", fg="#2c3e50")
        title_label.pack(pady=10)
        
        # 現在の点数と手札
        calc = CalcCardPoint(self.current_hand)
        current_points = calc.calc()
        
        info_frame = tk.Frame(suggestion_window, bg="#f0f0f0")
        info_frame.pack(pady=5)
        
        current_label = tk.Label(info_frame, 
                                 text=f"現在の点数: {current_points}点",
                                 font=("Arial", 12, "bold"), bg="#f0f0f0")
        current_label.pack()
        
        # 現在の手札を画像で表示
        hand_frame = tk.Frame(info_frame, bg="#ecf0f1", relief=tk.RIDGE, bd=2)
        hand_frame.pack(pady=5)
        
        tk.Label(hand_frame, text="現在の手札:", font=("Arial", 10), bg="#ecf0f1").pack(side=tk.LEFT, padx=5)
        
        for card in self.current_hand:
            if self.card_images_small[card]:
                card_label = tk.Label(hand_frame, image=self.card_images_small[card], bg="#ecf0f1")
                card_label.pack(side=tk.LEFT, padx=2)
            else:
                card_label = tk.Label(hand_frame, text=card, font=("Arial", 9), 
                                    bg="white", width=8, height=5, relief=tk.RAISED, bd=1)
                card_label.pack(side=tk.LEFT, padx=2)
        
        # スクロール可能なフレーム
        canvas = tk.Canvas(suggestion_window, bg="#f0f0f0")
        scrollbar = ttk.Scrollbar(suggestion_window, orient="vertical", command=canvas.yview)
        scrollable = tk.Frame(canvas, bg="#f0f0f0")
        
        scrollable.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=scrollable, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 提案リスト
        if suggestions:
            for i, sug in enumerate(suggestions[:20], 1):
                frame = tk.Frame(scrollable, bg="#ecf0f1", relief=tk.RAISED, bd=2)
                frame.pack(fill=tk.X, padx=5, pady=5)
                
                # ランキングと情報
                top_frame = tk.Frame(frame, bg="#ecf0f1")
                top_frame.pack(fill=tk.X, padx=5, pady=5)
                
                rank_label = tk.Label(top_frame, text=f"#{i}", font=("Arial", 12, "bold"),
                                     bg="#ecf0f1", width=4)
                rank_label.pack(side=tk.LEFT, padx=5)
                
                info_inner_frame = tk.Frame(top_frame, bg="#ecf0f1")
                info_inner_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=5)
                
                action_label = tk.Label(info_inner_frame, text=f"[{sug['type']}] {sug['action']}", 
                                       font=("Arial", 11), bg="#ecf0f1", anchor="w")
                action_label.pack(fill=tk.X)
                
                result_label = tk.Label(info_inner_frame, 
                                       text=f"結果: {sug['points']}点 (+{sug['diff']}点)",
                                       font=("Arial", 10), bg="#ecf0f1", fg="#27ae60", anchor="w")
                result_label.pack(fill=tk.X)
                
                # 結果の手札を画像で表示
                result_hand_frame = tk.Frame(frame, bg="#ecf0f1")
                result_hand_frame.pack(fill=tk.X, padx=5, pady=5)
                
                tk.Label(result_hand_frame, text="→", font=("Arial", 10, "bold"), 
                        bg="#ecf0f1").pack(side=tk.LEFT, padx=5)
                
                for card in sug['result_hand']:
                    if self.card_images_small[card]:
                        card_label = tk.Label(result_hand_frame, image=self.card_images_small[card], bg="#ecf0f1")
                        card_label.pack(side=tk.LEFT, padx=2)
                    else:
                        card_label = tk.Label(result_hand_frame, text=card, font=("Arial", 8), 
                                            bg="white", width=6, height=4, relief=tk.RAISED, bd=1)
                        card_label.pack(side=tk.LEFT, padx=2)
        else:
            no_sug_label = tk.Label(scrollable, 
                                   text="改善案が見つかりませんでした。\n現在の手札が最適かもしれません！",
                                   font=("Arial", 12), bg="#f0f0f0", fg="#7f8c8d")
            no_sug_label.pack(pady=50)

    def generate_suggestions(self):
        """改善案を生成"""
        all_cards = ESSENTIAL + PROTEIN + SEASONING + TOPPING
        current_calc = CalcCardPoint(self.current_hand)
        current_points = current_calc.calc()
        
        suggestions = []
        
        # カード交換
        for i, old_card in enumerate(self.current_hand):
            if old_card in ESSENTIAL:
                for new_card in ESSENTIAL:
                    if new_card not in self.current_hand:
                        new_hand = self.current_hand[:i] + [new_card] + self.current_hand[i+1:]
                        new_calc = CalcCardPoint(new_hand)
                        new_points = new_calc.calc()
                        if new_points > current_points:
                            diff = new_points - current_points
                            suggestions.append({
                                'type': '交換',
                                'action': f'「{old_card}」→「{new_card}」',
                                'points': new_points,
                                'diff': diff,
                                'result_hand': new_hand
                            })
            else:
                for new_card in all_cards:
                    if new_card not in self.current_hand:
                        new_hand = self.current_hand[:i] + [new_card] + self.current_hand[i+1:]
                        new_calc = CalcCardPoint(new_hand)
                        new_points = new_calc.calc()
                        if new_points > current_points:
                            diff = new_points - current_points
                            suggestions.append({
                                'type': '交換',
                                'action': f'「{old_card}」→「{new_card}」',
                                'points': new_points,
                                'diff': diff,
                                'result_hand': new_hand
                            })
        
        # カード追加
        if len(self.current_hand) < 5:
            for new_card in all_cards:
                if new_card not in self.current_hand:
                    new_hand = self.current_hand + [new_card]
                    new_calc = CalcCardPoint(new_hand)
                    new_points = new_calc.calc()
                    if new_points > current_points:
                        diff = new_points - current_points
                        suggestions.append({
                            'type': '追加',
                            'action': f'「{new_card}」を追加',
                            'points': new_points,
                            'diff': diff,
                            'result_hand': new_hand
                        })
        
        suggestions.sort(key=lambda x: x['diff'], reverse=True)
        return suggestions

    def show_best_combinations(self):
        """最高得点の組み合わせを表示"""
        # 最高得点の組み合わせを計算
        best_combos = self.calculate_best_combinations()
        
        # 新しいウィンドウを作成
        best_window = tk.Toplevel(self.root)
        best_window.title("最高得点の組み合わせ")
        best_window.geometry("900x700")
        best_window.configure(bg="#f0f0f0")
        
        # タイトル
        title_label = tk.Label(best_window, text="最高得点の組み合わせ TOP10", 
                              font=("Arial", 16, "bold"), bg="#f0f0f0", fg="#2c3e50")
        title_label.pack(pady=10)
        
        # スクロール可能なフレーム
        canvas = tk.Canvas(best_window, bg="#f0f0f0")
        scrollbar = ttk.Scrollbar(best_window, orient="vertical", command=canvas.yview)
        scrollable = tk.Frame(canvas, bg="#f0f0f0")
        
        scrollable.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=scrollable, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # TOP10を表示
        for i, combo in enumerate(best_combos[:10], 1):
            frame = tk.Frame(scrollable, bg="#ecf0f1", relief=tk.RAISED, bd=3)
            frame.pack(fill=tk.X, padx=10, pady=10)
            
            # ランキングと点数
            header_frame = tk.Frame(frame, bg="#2c3e50")
            header_frame.pack(fill=tk.X)
            
            rank_label = tk.Label(header_frame, text=f"#{i}", 
                                 font=("Arial", 16, "bold"),
                                 bg="#2c3e50", fg="white", width=5)
            rank_label.pack(side=tk.LEFT, padx=10, pady=5)
            
            score_label = tk.Label(header_frame, 
                                  text=f"{combo['points']}点",
                                  font=("Arial", 18, "bold"),
                                  bg="#2c3e50", fg="#f39c12")
            score_label.pack(side=tk.LEFT, padx=10, pady=5)
            
            card_count_label = tk.Label(header_frame,
                                       text=f"({combo['card_count']}枚)",
                                       font=("Arial", 12),
                                       bg="#2c3e50", fg="white")
            card_count_label.pack(side=tk.LEFT, padx=5, pady=5)
            
            # カード画像表示
            cards_frame = tk.Frame(frame, bg="#ecf0f1")
            cards_frame.pack(fill=tk.X, padx=10, pady=10)
            
            for card in combo['cards']:
                if self.card_images[card]:
                    card_label = tk.Label(cards_frame, image=self.card_images[card], bg="#ecf0f1")
                    card_label.pack(side=tk.LEFT, padx=5)
                else:
                    card_label = tk.Label(cards_frame, text=card, font=("Arial", 10), 
                                        bg="white", width=12, height=8, 
                                        relief=tk.RAISED, bd=2)
                    card_label.pack(side=tk.LEFT, padx=5)
            
            # 採用ボタン
            adopt_btn = tk.Button(frame, text="この手札を採用",
                                 font=("Arial", 10, "bold"),
                                 bg="#27ae60", fg="white",
                                 padx=15, pady=5,
                                 command=lambda c=combo['cards']: self.adopt_hand(c, best_window))
            adopt_btn.pack(pady=5)

    def calculate_best_combinations(self):
        """すべての組み合わせから最高得点を計算"""
        from itertools import combinations
        
        other_cards = PROTEIN + SEASONING + TOPPING
        all_combos = []
        
        # 3～5枚の組み合わせを生成
        for n in range(3, 6):
            for essential_card in ESSENTIAL:
                for combo in combinations(other_cards, n - 1):
                    cards = [essential_card] + list(combo)
                    calc = CalcCardPoint(cards)
                    points = calc.calc()
                    all_combos.append({
                        'cards': cards,
                        'points': points,
                        'card_count': len(cards)
                    })
        
        # 点数でソート
        all_combos.sort(key=lambda x: x['points'], reverse=True)
        return all_combos
    
    def adopt_hand(self, cards, window):
        """手札を採用してメイン画面に反映"""
        self.current_hand = cards.copy()
        self.update_display()
        window.destroy()
    
    def random_hand(self):
        """ランダムに手札を選択"""
        # ESSENTIALから1枚選択
        essential_card = random.choice(ESSENTIAL)
        
        # その他のカード
        other_cards = PROTEIN + SEASONING + TOPPING
        
        # ランダムに枚数を決定（3～5枚）
        total_cards = random.randint(3, 5)
        
        # 残りの枚数分をランダムに選択
        remaining_count = total_cards - 1
        selected_others = random.sample(other_cards, remaining_count)
        
        # 手札を設定
        self.current_hand = [essential_card] + selected_others
        self.update_display()


if __name__ == "__main__":
    root = tk.Tk()
    app = CardGameGUI(root)
    root.mainloop()