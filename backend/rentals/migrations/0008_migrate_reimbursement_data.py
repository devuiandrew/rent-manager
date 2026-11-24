# Ручна data-міграція: плоскі поля Contract.reimbursement_* → модель ReimbursementContract.
# Групування за точним рядком номера (договори під одним документом мають однаковий номер).
from datetime import timedelta

from django.db import migrations


def _year_end(d):
    """d + 1 рік − 1 день; 29.02 у високосному році → 28.02 наступного."""
    try:
        nxt = d.replace(year=d.year + 1)
    except ValueError:
        nxt = d.replace(year=d.year + 1, day=28)
    return nxt - timedelta(days=1)


def forwards(apps, schema_editor):
    """Створюємо документ на кожен унікальний номер відшкодування і лінкуємо договори."""
    Contract = apps.get_model('rentals', 'Contract')
    ReimbursementContract = apps.get_model('rentals', 'ReimbursementContract')

    groups = {}
    for c in Contract.objects.exclude(reimbursement_number='').order_by('id'):
        groups.setdefault(c.reimbursement_number, []).append(c)

    for number, contracts in groups.items():
        # Ідемпотентність: повторний запуск не дублює документи
        if ReimbursementContract.objects.filter(number=number).exists():
            continue
        # Дата початку: найраніша із заповнених дат відшкодування,
        # fallback — найраніший початок самих договорів
        starts = [c.reimbursement_date_start for c in contracts if c.reimbursement_date_start]
        ds = min(starts) if starts else min(c.date_start for c in contracts)
        doc = ReimbursementContract.objects.create(
            number=number,
            date_start=ds,
            date_end=_year_end(ds),
            note='Перенесено з полів договору',
        )
        doc.contracts.set(contracts)


def backwards(apps, schema_editor):
    """Зворотній бік: повертаємо номер/дату в плоскі поля, документи видаляємо."""
    ReimbursementContract = apps.get_model('rentals', 'ReimbursementContract')
    for doc in ReimbursementContract.objects.all():
        doc.contracts.all().update(
            reimbursement_number=doc.number,
            reimbursement_date_start=doc.date_start,
        )
    ReimbursementContract.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('rentals', '0007_reimbursementcontract'),
    ]
    operations = [
        migrations.RunPython(forwards, backwards),
    ]
