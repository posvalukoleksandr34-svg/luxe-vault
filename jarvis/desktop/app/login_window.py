"""First-run sign-in window (tkinter: part of Python, nothing extra to bundle)."""

from __future__ import annotations

import threading
import tkinter as tk
import webbrowser
from tkinter import ttk

from app.api import LoginError, device_login
from app.config import APP_NAME, SERVER_URL, resource

BG, SURFACE, TEXT, MUTED, ACCENT, DANGER = "#0b0d10", "#14181d", "#e6edf3", "#8d99a8", "#4fd1e8", "#f87171"


def ask_login() -> str | None:
    """Show the window; return the device token after a successful sign-in, None if the user closed it."""
    result: dict[str, str | None] = {"token": None}
    root = tk.Tk()
    root.title(f"{APP_NAME} — вход")
    root.configure(bg=BG)
    root.resizable(False, False)
    try:
        root.iconbitmap(str(resource("jarvis.ico")))
    except tk.TclError:
        pass
    w, h = 400, 460
    root.geometry(f"{w}x{h}+{(root.winfo_screenwidth() - w) // 2}+{(root.winfo_screenheight() - h) // 3}")

    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("J.TEntry", fieldbackground=SURFACE, foreground=TEXT, bordercolor="#2a313a",
                    lightcolor="#2a313a", darkcolor="#2a313a", insertcolor=TEXT, padding=8)
    style.configure("J.TButton", background=ACCENT, foreground="#041016", borderwidth=0, padding=10,
                    font=("Segoe UI", 10, "bold"))
    style.map("J.TButton", background=[("disabled", "#2a313a"), ("active", "#8be9f7")])

    tk.Label(root, text="J A R V I S", bg=BG, fg=TEXT, font=("Segoe UI", 16, "bold")).pack(pady=(32, 4))
    tk.Label(root, text="Войдите в свой аккаунт", bg=BG, fg=MUTED, font=("Segoe UI", 10)).pack()

    form = tk.Frame(root, bg=BG)
    form.pack(fill="x", padx=40, pady=(24, 0))

    def field(label: str, show: str = "") -> ttk.Entry:
        tk.Label(form, text=label, bg=BG, fg=MUTED, font=("Segoe UI", 9), anchor="w").pack(fill="x", pady=(10, 2))
        e = ttk.Entry(form, style="J.TEntry", show=show, font=("Segoe UI", 10))
        e.pack(fill="x")
        return e

    email = field("E-mail")
    password = field("Пароль", show="•")
    totp_label = tk.Label(form, text="Код 2FA", bg=BG, fg=MUTED, font=("Segoe UI", 9), anchor="w")
    totp = ttk.Entry(form, style="J.TEntry", font=("Segoe UI", 10))
    error = tk.Label(root, text="", bg=BG, fg=DANGER, font=("Segoe UI", 9), wraplength=320, justify="left")
    error.pack(fill="x", padx=40, pady=(12, 0))
    button = ttk.Button(root, text="Войти", style="J.TButton")
    button.pack(fill="x", padx=40, pady=(12, 0))
    links = tk.Frame(root, bg=BG)
    links.pack(fill="x", padx=40, pady=(14, 0))
    for text, path in (("Создать аккаунт", "/signup"), ("Забыли пароль?", "/forgot")):
        lbl = tk.Label(links, text=text, bg=BG, fg=ACCENT, cursor="hand2", font=("Segoe UI", 9, "underline"))
        lbl.pack(side="left" if path == "/signup" else "right")
        lbl.bind("<Button-1>", lambda _e, p=path: webbrowser.open(SERVER_URL + p))

    def done(token: str) -> None:
        result["token"] = token
        root.destroy()

    def failed(exc: LoginError) -> None:
        button.state(["!disabled"])
        button.configure(text="Войти")
        error.configure(text=str(exc))
        if exc.needs_totp and not totp.winfo_ismapped():
            totp_label.pack(fill="x", pady=(10, 2))
            totp.pack(fill="x")
            totp.focus_set()

    def submit(_event=None) -> None:  # noqa: ANN001 - tkinter event
        if not email.get().strip() or not password.get():
            error.configure(text="Введите e-mail и пароль.")
            return
        button.state(["disabled"])
        button.configure(text="Входим…")
        error.configure(text="")
        args = (email.get(), password.get(), totp.get() if totp.winfo_ismapped() else None)

        def work() -> None:  # network off the UI thread; results back via after()
            try:
                token = device_login(*args)
                root.after(0, done, token)
            except LoginError as exc:
                root.after(0, failed, exc)

        threading.Thread(target=work, daemon=True).start()

    button.configure(command=submit)
    root.bind("<Return>", submit)
    email.focus_set()
    root.mainloop()
    return result["token"]
