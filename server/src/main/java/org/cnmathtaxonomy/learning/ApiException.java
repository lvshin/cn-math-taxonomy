package org.cnmathtaxonomy.learning;

import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message);
    }

    static ApiException forbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "没有执行此操作的权限");
    }

    static ApiException missing() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "资源不存在或不可访问");
    }

    static ApiException conflict(String code) {
        return new ApiException(HttpStatus.CONFLICT, code, "记录状态已改变，请刷新后重试");
    }
}
