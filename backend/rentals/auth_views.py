from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["name"] = user.get_full_name() or user.username
        # Роль: admin > accountant > operator (default)
        if user.is_staff:
            token["role"] = "admin"
        elif user.groups.filter(name="Бухгалтер").exists():
            token["role"] = "accountant"
        else:
            token["role"] = "manager"
        return token


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
