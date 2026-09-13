import sys
import time
import math
import winsound
import os
import subprocess
from PyQt6.QtCore import QTimer, Qt, QRectF
from PyQt6.QtGui import QPainter, QPen, QColor, QFont, QLinearGradient, QRadialGradient, QIcon, QPixmap, QAction
from PyQt6.QtWidgets import (
    QApplication,
    QWidget,
    QLabel,
    QLineEdit,
    QPushButton,
    QMessageBox,
    QVBoxLayout,
    QHBoxLayout,
    QTabWidget,
    QSpinBox,
    QFrame,
    QSystemTrayIcon,
    QMenu,
)


def create_app_icon():
    pixmap = QPixmap(64, 64)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setBrush(QColor("#0f172a"))
    painter.setPen(QPen(QColor("#fbbf24"), 3))
    painter.drawEllipse(QRectF(5, 5, 54, 54))
    painter.setPen(QPen(QColor("#f8fafc"), 3))
    painter.drawLine(32, 17, 32, 32)
    painter.drawLine(32, 32, 44, 39)
    painter.setBrush(QColor("#fbbf24"))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawEllipse(QRectF(28, 28, 8, 8))
    painter.end()
    return QIcon(pixmap)


class ReminderToast(QWidget):
    def __init__(self, title, message, icon, accent="#fbbf24"):
        super().__init__(None)
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.Tool
            | Qt.WindowType.WindowStaysOnTopHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        self.setFixedSize(360, 112)
        self.setWindowIcon(icon)
        self.setStyleSheet(
            f"background: #0f172a; color: #f8fafc; border: 2px solid {accent}; border-radius: 12px;"
        )

        title_label = QLabel(title)
        title_label.setStyleSheet(f"font-size: 17px; font-weight: bold; color: {accent}; border: none;")
        message_label = QLabel(message)
        message_label.setWordWrap(True)
        message_label.setStyleSheet("font-size: 13px; color: #e2e8f0; border: none;")
        close_button = QPushButton("知道了")
        close_button.setFixedWidth(72)
        close_button.setStyleSheet(
            f"background: {accent}; color: #0f172a; border: none; border-radius: 6px; padding: 5px 8px;"
        )
        close_button.clicked.connect(self.close)

        content = QVBoxLayout(self)
        content.setContentsMargins(16, 12, 16, 10)
        content.setSpacing(5)
        content.addWidget(title_label)
        content.addWidget(message_label)
        content.addWidget(close_button, alignment=Qt.AlignmentFlag.AlignRight)

        QTimer.singleShot(9000, self.close)

    def show_bottom_right(self):
        screen = QApplication.primaryScreen()
        if screen:
            area = screen.availableGeometry()
            self.move(area.right() - self.width() - 18, area.bottom() - self.height() - 18)
        self.show()
        self.raise_()


class MetallicDial(QWidget):
    def __init__(self, parent=None, title="", accent="#7dd3fc"):
        super().__init__(parent)
        self.title = title
        self.accent = accent
        self.value = 0.0
        self.max_value = 60.0
        self.mode = "stopwatch"
        self.text = "00:00:00.00"
        self.setMinimumSize(200, 200)

    def set_metric(self, mode, value, max_value, text):
        self.mode = mode
        self.value = value
        self.max_value = max_value
        self.text = text
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = self.rect().adjusted(10, 10, -10, -10)
        center = rect.center()
        radius = min(rect.width(), rect.height()) / 2

        metal_grad = QRadialGradient(float(center.x()), float(center.y()), float(radius))
        metal_grad.setColorAt(0.0, QColor("#f8fafc"))
        metal_grad.setColorAt(0.2, QColor("#dfe7ef"))
        metal_grad.setColorAt(0.45, QColor("#94a3b8"))
        metal_grad.setColorAt(1.0, QColor("#475569"))
        painter.setBrush(metal_grad)
        painter.setPen(QPen(QColor("#cbd5e1"), 3))
        painter.drawEllipse(center, int(radius), int(radius))

        inner_grad = QLinearGradient(0, 0, self.width(), self.height())
        inner_grad.setColorAt(0.0, QColor("#0f172a"))
        inner_grad.setColorAt(0.5, QColor("#1e293b"))
        inner_grad.setColorAt(1.0, QColor("#020817"))
        painter.setBrush(inner_grad)
        painter.setPen(QPen(QColor("#64748b"), 2))
        painter.drawEllipse(center, int(radius * 0.82), int(radius * 0.82))

        for i in range(60):
            angle = -90 + i * 6
            rad = math.radians(angle)
            outer_x = center.x() + radius * math.cos(rad)
            outer_y = center.y() + radius * math.sin(rad)
            inner_r = radius * 0.84 if i % 5 == 0 else radius * 0.89
            inner_x = center.x() + inner_r * math.cos(rad)
            inner_y = center.y() + inner_r * math.sin(rad)
            painter.setPen(QPen(QColor("#e2e8f0") if i % 5 == 0 else QColor("#94a3b8"), 2 if i % 5 == 0 else 1))
            painter.drawLine(int(inner_x), int(inner_y), int(outer_x), int(outer_y))

        for num, angle in [(12, -90), (3, 0), (6, 90), (9, 180)]:
            rad = math.radians(angle)
            x = center.x() + (radius * 0.68) * math.cos(rad)
            y = center.y() + (radius * 0.68) * math.sin(rad)
            painter.setPen(QColor("#f8fafc"))
            painter.setFont(QFont("Microsoft YaHei", 12, QFont.Weight.Bold))
            painter.drawText(int(x - 8), int(y + 6), str(num))

        if self.mode == "countdown":
            remaining = max(0.0, min(self.value, self.max_value))
            ratio = remaining / max(1.0, self.max_value)
            painter.setPen(QPen(QColor("#334155"), 14))
            painter.drawArc(int(center.x() - radius + 18), int(center.y() - radius + 18),
                            int(radius * 2 - 36), int(radius * 2 - 36), 0, 360 * 16)
            painter.setPen(QPen(QColor(self.accent), 14))
            painter.drawArc(int(center.x() - radius + 18), int(center.y() - radius + 18),
                            int(radius * 2 - 36), int(radius * 2 - 36),
                            90 * 16, int(-360 * ratio * 16))
            hand_angle = -90 + (1.0 - ratio) * 360
            hand_rad = math.radians(hand_angle)
            end_x = center.x() + (radius - 30) * math.cos(hand_rad)
            end_y = center.y() + (radius - 30) * math.sin(hand_rad)
            painter.setPen(QPen(QColor("#f59e0b"), 4))
            painter.drawLine(center.x(), center.y(), int(end_x), int(end_y))

        elif self.mode == "current":
            now = time.localtime()
            seconds_total = now.tm_hour * 3600 + now.tm_min * 60 + now.tm_sec
            ratio = seconds_total / 43200.0
            base_angle = -90 + ratio * 360
            for angle, length, color in [
                (-90 + (now.tm_sec / 60.0) * 360, radius * 0.70, QColor("#f87171")),
                (-90 + ((now.tm_min + now.tm_sec / 60.0) / 60.0) * 360, radius * 0.56, QColor("#7dd3fc")),
                (-90 + ((now.tm_hour % 12) + now.tm_min / 60.0 + now.tm_sec / 3600.0) / 12.0 * 360, radius * 0.42, QColor("#fbbf24")),
            ]:
                rad = math.radians(angle)
                x = center.x() + length * math.cos(rad)
                y = center.y() + length * math.sin(rad)
                painter.setPen(QPen(color, 3 if color != QColor("#7dd3fc") else 4))
                painter.drawLine(center.x(), center.y(), int(x), int(y))

        else:
            progress = self.value / max(1.0, self.max_value)
            painter.setPen(QPen(QColor("#334155"), 12))
            painter.drawArc(int(center.x() - radius + 18), int(center.y() - radius + 18),
                            int(radius * 2 - 36), int(radius * 2 - 36), 0, 360 * 16)
            painter.setPen(QPen(QColor(self.accent), 12))
            painter.drawArc(int(center.x() - radius + 18), int(center.y() - radius + 18),
                            int(radius * 2 - 36), int(radius * 2 - 36), -90 * 16, int(progress * 360 * 16))
            angle = -90 + progress * 360
            rad = math.radians(angle)
            x = center.x() + (radius - 30) * math.cos(rad)
            y = center.y() + (radius - 30) * math.sin(rad)
            painter.setPen(QPen(QColor("#60a5fa"), 4))
            painter.drawLine(center.x(), center.y(), int(x), int(y))

        painter.setPen(QPen(QColor("#f8fafc"), 2))
        painter.setBrush(QColor("#f8fafc"))
        painter.drawEllipse(center.x() - 7, center.y() - 7, 14, 14)

        painter.setPen(QColor(self.accent))
        painter.setFont(QFont("Microsoft YaHei", 9, QFont.Weight.Bold))
        title_rect = self.rect().adjusted(0, int(self.height() * 0.18), 0, 0)
        painter.drawText(title_rect, Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop, self.title)


class AlarmTab(QWidget):
    def __init__(self, notification_callback=None):
        super().__init__()
        self.notification_callback = notification_callback
        self.alarm_time = None
        self.alarm_timer = QTimer(self)
        self.alarm_timer.setInterval(500)
        self.alarm_timer.timeout.connect(self.check_alarm)

        self.current_time_label = QLabel(time.strftime("%H:%M:%S"))
        self.current_time_label.setStyleSheet("font-size: 28px; font-weight: bold; color: #7dd3fc;")

        self.label = QLabel("设置闹钟时间（HH:MM）")
        self.input_box = QLineEdit(time.strftime("%H:%M"))
        self.input_box.setStyleSheet("font-size: 22px; min-height: 35px; background: #111827; color: #f8fafc; border: 1px solid #334155; border-radius: 6px;")

        self.status_label = QLabel("当前状态：未设置闹钟")
        self.status_label.setStyleSheet("font-size: 12px; color: #93c5fd;")

        self.set_button = QPushButton("设置闹钟")
        self.cancel_button = QPushButton("取消闹钟")
        self.set_button.setStyleSheet("background: #2563eb; color: white; border-radius: 8px; padding: 8px;")
        self.cancel_button.setStyleSheet("background: #475569; color: white; border-radius: 8px; padding: 8px;")
        self.set_button.clicked.connect(self.set_alarm)
        self.cancel_button.clicked.connect(self.cancel_alarm)

        btn_layout = QHBoxLayout()
        btn_layout.addWidget(self.set_button)
        btn_layout.addWidget(self.cancel_button)

        layout = QVBoxLayout(self)
        layout.addWidget(self.current_time_label)
        layout.addWidget(self.label)
        layout.addWidget(self.input_box)
        layout.addLayout(btn_layout)
        layout.addWidget(self.status_label)

        self.clock_update = QTimer(self)
        self.clock_update.setInterval(1000)
        self.clock_update.timeout.connect(self.update_clock)
        self.clock_update.start()
        self.update_clock()

    def update_clock(self):
        self.current_time_label.setText(time.strftime("%H:%M:%S"))

    def set_alarm(self):
        value = self.input_box.text().strip()
        try:
            hour, minute = map(int, value.split(":"))
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError
        except ValueError:
            QMessageBox.critical(self, "错误", "时间格式必须是 HH:MM，例如 08:30")
            return

        self.alarm_time = (hour, minute)
        self.status_label.setText(f"当前状态：闹钟已设置为 {hour:02d}:{minute:02d}")
        self.alarm_timer.start()

    def cancel_alarm(self):
        self.alarm_time = None
        self.alarm_timer.stop()
        self.status_label.setText("当前状态：未设置闹钟")

    def check_alarm(self):
        if self.alarm_time is None:
            return
        now = time.localtime()
        if now.tm_hour == self.alarm_time[0] and now.tm_min == self.alarm_time[1]:
            self.trigger_alarm()

    def trigger_alarm(self):
        self.alarm_timer.stop()
        self.status_label.setText("当前状态：时间到！")
        message = f"闹钟已到点\n当前时间：{time.strftime('%H:%M:%S')}"
        if self.notification_callback:
            self.notification_callback("闹钟提醒", message)
        self.reminder_toast = ReminderToast("闹钟提醒", message, self.window().windowIcon(), "#f87171")
        self.reminder_toast.show_bottom_right()
        self.beep_count = 0
        self.beep_timer = QTimer(self)
        self.beep_timer.setInterval(350)
        self.beep_timer.timeout.connect(self.play_alarm_beep)
        self.beep_timer.start()

    def play_alarm_beep(self):
        winsound.Beep(1000, 180)
        self.beep_count += 1
        if self.beep_count >= 5:
            self.beep_timer.stop()


class TimingDashboard(QWidget):
    def __init__(self, notification_callback=None):
        super().__init__()
        self.notification_callback = notification_callback
        self.countdown_total_ms = 0
        self.countdown_remaining_ms = 0
        self.countdown_running = False
        self.stopwatch_elapsed_ms = 0
        self.stopwatch_running = False
        self.completed_blink = False
        self.flash_timer = QTimer(self)
        self.flash_timer.setInterval(120)
        self.flash_timer.timeout.connect(self.flash_completion)

        self.countdown_timer = QTimer(self)
        self.countdown_timer.setInterval(50)
        self.countdown_timer.timeout.connect(self.tick_countdown)

        self.stopwatch_timer = QTimer(self)
        self.stopwatch_timer.setInterval(10)
        self.stopwatch_timer.timeout.connect(self.tick_stopwatch)

        self.current_time_label = QLabel(time.strftime("%H:%M:%S"))
        self.current_time_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.current_time_label.setStyleSheet("font-size: 22px; font-weight: bold; color: #7dd3fc;")

        self.current_time_dial = MetallicDial(self, "当前时间", "#7dd3fc")
        self.current_time_dial.set_metric("current", 0, 43200, time.strftime("%H:%M:%S"))
        self.countdown_dial = MetallicDial(self, "倒计时", "#fbbf24")
        self.stopwatch_dial = MetallicDial(self, "秒表", "#7dd3fc")
        self.countdown_dial.set_metric("countdown", 0, 1, "00:00:00")
        self.stopwatch_dial.set_metric("stopwatch", 0, 60, "00:00:00.00")

        self.countdown_display = QLabel("00:00:00")
        self.countdown_display.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.countdown_display.setStyleSheet("font-size: 26px; font-weight: bold; color: #fbbf24;")

        self.stopwatch_display = QLabel("00:00:00.00")
        self.stopwatch_display.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.stopwatch_display.setStyleSheet("font-size: 26px; font-weight: bold; color: #7dd3fc;")

        self.min_box = QSpinBox()
        self.min_box.setRange(0, 99)
        self.min_box.setValue(1)
        self.sec_box = QSpinBox()
        self.sec_box.setRange(0, 59)
        self.sec_box.setValue(30)
        self.min_box.setStyleSheet("background: #111827; color: white; border: 1px solid #334155; border-radius: 6px;")
        self.sec_box.setStyleSheet("background: #111827; color: white; border: 1px solid #334155; border-radius: 6px;")

        self.cd_start = QPushButton("开始")
        self.cd_pause = QPushButton("暂停")
        self.cd_reset = QPushButton("重置")
        self.sw_start = QPushButton("开始")
        self.sw_pause = QPushButton("暂停")
        self.sw_reset = QPushButton("重置")

        for btn in [self.cd_start, self.cd_pause, self.cd_reset, self.sw_start, self.sw_pause, self.sw_reset]:
            btn.setStyleSheet("background: #1e293b; color: white; border-radius: 8px; padding: 8px;")
        self.cd_start.setStyleSheet("background: #16a34a; color: white; border-radius: 8px; padding: 8px;")
        self.cd_pause.setStyleSheet("background: #f59e0b; color: white; border-radius: 8px; padding: 8px;")
        self.cd_reset.setStyleSheet("background: #475569; color: white; border-radius: 8px; padding: 8px;")
        self.sw_start.setStyleSheet("background: #2563eb; color: white; border-radius: 8px; padding: 8px;")
        self.sw_pause.setStyleSheet("background: #f59e0b; color: white; border-radius: 8px; padding: 8px;")
        self.sw_reset.setStyleSheet("background: #475569; color: white; border-radius: 8px; padding: 8px;")

        self.cd_start.clicked.connect(self.start_countdown)
        self.cd_pause.clicked.connect(self.pause_countdown)
        self.cd_reset.clicked.connect(self.reset_countdown)
        self.sw_start.clicked.connect(self.start_stopwatch)
        self.sw_pause.clicked.connect(self.pause_stopwatch)
        self.sw_reset.clicked.connect(self.reset_stopwatch)

        countdown_controls = QHBoxLayout()
        countdown_controls.addWidget(QLabel("分"))
        countdown_controls.addWidget(self.min_box)
        countdown_controls.addWidget(QLabel("秒"))
        countdown_controls.addWidget(self.sec_box)

        cd_btns = QHBoxLayout()
        cd_btns.addWidget(self.cd_start)
        cd_btns.addWidget(self.cd_pause)
        cd_btns.addWidget(self.cd_reset)

        sw_btns = QHBoxLayout()
        sw_btns.addWidget(self.sw_start)
        sw_btns.addWidget(self.sw_pause)
        sw_btns.addWidget(self.sw_reset)

        left_v = QVBoxLayout()
        left_v.setContentsMargins(14, 12, 14, 14)
        left_v.setSpacing(8)
        left_v.addWidget(self.countdown_dial)
        left_v.addWidget(self.countdown_display)
        left_v.addLayout(countdown_controls)
        left_v.addLayout(cd_btns)

        right_v = QVBoxLayout()
        right_v.setContentsMargins(14, 12, 14, 14)
        right_v.setSpacing(8)
        right_v.addWidget(self.stopwatch_dial)
        right_v.addWidget(self.stopwatch_display)
        right_v.addLayout(sw_btns)

        clock_panel = QVBoxLayout()
        clock_panel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        clock_panel.addWidget(self.current_time_dial, alignment=Qt.AlignmentFlag.AlignCenter)
        clock_panel.addWidget(self.current_time_label)

        countdown_panel = QFrame()
        countdown_panel.setObjectName("countdownPanel")
        countdown_panel.setLayout(left_v)

        stopwatch_panel = QFrame()
        stopwatch_panel.setObjectName("stopwatchPanel")
        stopwatch_panel.setLayout(right_v)

        timing_panel = QHBoxLayout()
        timing_panel.setSpacing(14)
        timing_panel.addWidget(countdown_panel)
        timing_panel.addWidget(stopwatch_panel)

        panel = QVBoxLayout(self)
        panel.setContentsMargins(18, 12, 18, 18)
        panel.setSpacing(8)
        panel.addLayout(clock_panel)
        panel.addLayout(timing_panel)

        self.clock_update = QTimer(self)
        self.clock_update.setInterval(1000)
        self.clock_update.timeout.connect(self.update_current_time)
        self.clock_update.start()
        self.update_current_time()

    def format_countdown(self, ms):
        total_seconds = max(0, ms // 1000)
        hours, rem = divmod(total_seconds, 3600)
        minutes, seconds = divmod(rem, 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def format_stopwatch(self, ms):
        total_ms = int(ms)
        hours, rem = divmod(total_ms, 3600000)
        minutes, rem = divmod(rem, 60000)
        seconds, dec = divmod(rem, 1000)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{dec // 10:02d}"

    def update_current_time(self):
        current_time = time.strftime("%H:%M:%S")
        self.current_time_label.setText(current_time)
        now = time.localtime()
        seconds_total = now.tm_hour * 3600 + now.tm_min * 60 + now.tm_sec
        self.current_time_dial.set_metric("current", seconds_total, 43200, current_time)

    def start_countdown(self):
        if self.countdown_running:
            return
        total_seconds = self.min_box.value() * 60 + self.sec_box.value()
        if total_seconds <= 0:
            QMessageBox.warning(self, "提示", "请先设置倒计时时间")
            return
        self.countdown_total_ms = total_seconds * 1000
        self.countdown_remaining_ms = self.countdown_total_ms
        self.countdown_running = True
        self.countdown_timer.start()

    def pause_countdown(self):
        self.countdown_running = False
        self.countdown_timer.stop()

    def reset_countdown(self):
        self.countdown_running = False
        self.countdown_timer.stop()
        self.flash_timer.stop()
        if hasattr(self, "completion_beep_timer"):
            self.completion_beep_timer.stop()
        self.completed_blink = False
        self.countdown_remaining_ms = 0
        self.countdown_total_ms = 0
        self.countdown_display.setText("00:00:00")
        self.countdown_dial.set_metric("countdown", 0, 1, "00:00:00")
        self.countdown_display.setStyleSheet("font-size: 26px; font-weight: bold; color: #fbbf24;")
        self.countdown_dial.setStyleSheet("")

    def tick_countdown(self):
        if not self.countdown_running:
            return

        self.countdown_remaining_ms -= 50
        if self.countdown_remaining_ms <= 0:
            self.countdown_remaining_ms = 0
            self.countdown_running = False
            self.countdown_timer.stop()
            self.countdown_display.setText("00:00:00")
            self.countdown_dial.set_metric("countdown", 0, 1, "00:00:00")
            self.start_completion_flash()
            if self.notification_callback:
                self.notification_callback("倒计时完成", "倒计时已结束，请查看计时器")
            self.reminder_toast = ReminderToast(
                "倒计时完成", "倒计时已结束\n请查看计时器并进行下一步操作", self.window().windowIcon(), "#fbbf24"
            )
            self.reminder_toast.show_bottom_right()
            return

        self.countdown_dial.set_metric(
            "countdown",
            self.countdown_remaining_ms / 1000.0,
            self.countdown_total_ms / 1000.0,
            self.format_countdown(self.countdown_remaining_ms),
        )
        self.countdown_display.setText(self.format_countdown(self.countdown_remaining_ms))

    def start_completion_flash(self):
        self.completed_blink = True
        self.flash_timer.start()
        self.beep_count = 0
        self.completion_beep_timer = QTimer(self)
        self.completion_beep_timer.setInterval(300)
        self.completion_beep_timer.timeout.connect(self.play_completion_beep)
        self.completion_beep_timer.start()

    def play_completion_beep(self):
        winsound.Beep(1200, 160)
        self.beep_count += 1
        if self.beep_count >= 4:
            self.completion_beep_timer.stop()

    def flash_completion(self):
        if not self.completed_blink:
            self.flash_timer.stop()
            return

        self.countdown_display.setStyleSheet(
            "font-size: 26px; font-weight: bold; color: #ffffff; background: #f43f5e; border-radius: 8px;"
        )
        self.countdown_dial.setStyleSheet("border: 2px solid #f43f5e; border-radius: 110px;")
        QTimer.singleShot(80, self.reset_completion_flash)

    def reset_completion_flash(self):
        self.countdown_display.setStyleSheet("font-size: 26px; font-weight: bold; color: #fbbf24;")
        self.countdown_dial.setStyleSheet("")
        self.completed_blink = False
        self.flash_timer.stop()
        if hasattr(self, "completion_beep_timer"):
            self.completion_beep_timer.stop()

    def start_stopwatch(self):
        if self.stopwatch_running:
            return
        self.stopwatch_running = True
        self.stopwatch_timer.start()

    def pause_stopwatch(self):
        self.stopwatch_running = False
        self.stopwatch_timer.stop()

    def reset_stopwatch(self):
        self.stopwatch_running = False
        self.stopwatch_timer.stop()
        self.stopwatch_elapsed_ms = 0
        self.stopwatch_dial.set_metric("stopwatch", 0, 60, "00:00:00.00")
        self.stopwatch_display.setText("00:00:00.00")

    def tick_stopwatch(self):
        if not self.stopwatch_running:
            return
        self.stopwatch_elapsed_ms += 10
        self.stopwatch_dial.set_metric("stopwatch", self.stopwatch_elapsed_ms / 1000.0, 60, self.format_stopwatch(self.stopwatch_elapsed_ms))
        self.stopwatch_display.setText(self.format_stopwatch(self.stopwatch_elapsed_ms))


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("机械表工具")
        self.resize(900, 620)
        self.app_icon = create_app_icon()
        self.setWindowIcon(self.app_icon)
        self.setStyleSheet("""
            QWidget {
                background: #020817;
                color: #e2e8f0;
            }
            QTabWidget::pane {
                border: 1px solid #1e293b;
                background: #020817;
                border-radius: 10px;
            }
            QTabBar::tab {
                background: #0f172a;
                color: #cbd5e1;
                border: 1px solid #334155;
                border-bottom: none;
                border-top-left-radius: 8px;
                border-top-right-radius: 8px;
                padding: 8px 16px;
                margin-right: 2px;
            }
            QTabBar::tab:selected {
                background: #111827;
                color: #f8fafc;
            }
            QLabel { color: #e2e8f0; }
            QFrame#countdownPanel, QFrame#stopwatchPanel {
                background: #0b1220;
                border: 1px solid #243247;
                border-radius: 14px;
            }
            QFrame#countdownPanel { border-top: 2px solid #fbbf24; }
            QFrame#stopwatchPanel { border-top: 2px solid #7dd3fc; }
            QPushButton {
                border: none;
                min-height: 30px;
                padding: 6px 12px;
            }
            QPushButton:hover { background: #334155; }
            QSpinBox {
                border-radius: 6px;
                min-height: 28px;
                padding: 0 6px;
            }
        """)

        self.tabs = QTabWidget(self)
        self.tabs.addTab(AlarmTab(self.notify), "闹钟")
        self.tabs.addTab(TimingDashboard(self.notify), "计时")

        layout = QVBoxLayout(self)
        layout.addWidget(self.tabs)

        self.tray = QSystemTrayIcon(self.app_icon, self)
        self.tray.setToolTip("机械表工具")
        tray_menu = QMenu(self)
        show_action = QAction("打开主界面", self)
        show_action.triggered.connect(self.show_from_tray)
        shortcut_action = QAction("创建桌面快捷方式", self)
        shortcut_action.triggered.connect(self.create_desktop_shortcut)
        quit_action = QAction("退出程序", self)
        quit_action.triggered.connect(self.quit_application)
        tray_menu.addAction(show_action)
        tray_menu.addAction(shortcut_action)
        tray_menu.addSeparator()
        tray_menu.addAction(quit_action)
        self.tray.setContextMenu(tray_menu)
        self.tray.activated.connect(self.tray_activated)
        self.tray.show()
        self.create_desktop_shortcut(show_message=False)

    def notify(self, title, message):
        if self.tray.isVisible():
            self.tray.showMessage(title, message, QSystemTrayIcon.MessageIcon.Information, 8000)

    def show_from_tray(self):
        self.show()
        self.raise_()
        self.activateWindow()

    def tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self.show_from_tray()

    def create_desktop_shortcut(self, show_message=True):
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        shortcut_path = os.path.join(desktop, "机械表工具.lnk")
        python_path = sys.executable
        is_frozen = getattr(sys, "frozen", False)
        script_path = os.path.abspath(sys.argv[0])
        icon_path = os.path.join(desktop, "机械表工具.ico")
        self.app_icon.pixmap(64, 64).save(icon_path, "ICO")

        def ps_quote(value):
            return "'" + value.replace("'", "''") + "'"

        command = (
            "$shell = New-Object -ComObject WScript.Shell; "
            f"$shortcut = $shell.CreateShortcut({ps_quote(shortcut_path)}); "
            f"$shortcut.TargetPath = {ps_quote(python_path)}; "
            f"$shortcut.Arguments = {ps_quote('' if is_frozen else chr(34) + script_path + chr(34))}; "
            f"$shortcut.WorkingDirectory = {ps_quote(os.path.dirname(script_path))}; "
            f"$shortcut.IconLocation = {ps_quote(icon_path + ',0')}; "
            "$shortcut.Save()"
        )
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
                check=True,
                capture_output=True,
                text=True,
            )
            if show_message:
                self.notify("快捷方式已创建", "桌面上已添加“机械表工具”快捷方式")
        except (OSError, subprocess.CalledProcessError) as error:
            if show_message:
                QMessageBox.warning(self, "创建失败", f"无法创建桌面快捷方式：{error}")

    def quit_application(self):
        self.force_quit = True
        QApplication.instance().quit()

    def closeEvent(self, event):
        if getattr(self, "force_quit", False):
            event.accept()
            return
        event.ignore()
        self.hide()
        self.notify("程序仍在运行", "机械表工具已隐藏到系统托盘，双击托盘图标可重新打开")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
