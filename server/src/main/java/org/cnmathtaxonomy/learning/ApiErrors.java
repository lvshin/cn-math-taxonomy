package org.cnmathtaxonomy.learning;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ApiException.class)
    ProblemDetail business(ApiException error) {
        return problem(error.status(), error.code(), error.getMessage());
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class})
    ProblemDetail invalid(Exception error) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "请求格式或字段不正确");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail integrity(DataIntegrityViolationException error) {
        return problem(HttpStatus.CONFLICT, "DATA_CONFLICT", "记录已存在或关联关系已改变");
    }

    static ProblemDetail problem(HttpStatus status, String code, String message) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(status, message);
        detail.setProperty("code", code);
        return detail;
    }
}
